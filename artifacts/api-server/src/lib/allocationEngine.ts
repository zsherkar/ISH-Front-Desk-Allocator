import { db, shiftsTable, respondentsTable, responsesTable, allocationsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

export interface AllocationOptions {
  surveyId: number;
  afpCount?: number;
  afpMinHours?: number;
  afpMaxHours?: number;
}

export interface AllocationPlan {
  respondentId: number;
  name: string;
  category: string;
  shiftIds: number[];
  totalHours: number;
  isManuallyAdjusted: boolean;
  penaltyNote: string | null;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export async function runAllocation(options: AllocationOptions): Promise<{
  plans: AllocationPlan[];
  averageHours: number;
  stdDev: number;
  unallocatedShiftIds: number[];
}> {
  const { surveyId, afpMinHours = 3, afpMaxHours = 4 } = options;

  // Get all shifts for this survey
  const shifts = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.surveyId, surveyId));

  const shiftMap = new Map(shifts.map((s) => [s.id, s]));

  // Get all responses for this survey, joined with respondents
  const responses = await db
    .select({
      respondentId: responsesTable.respondentId,
      shiftId: responsesTable.shiftId,
      respondentName: respondentsTable.name,
      respondentCategory: respondentsTable.category,
    })
    .from(responsesTable)
    .innerJoin(respondentsTable, eq(responsesTable.respondentId, respondentsTable.id))
    .where(eq(responsesTable.surveyId, surveyId));

  // Group responses by respondent
  const respondentMap = new Map<
    number,
    { id: number; name: string; category: string; availableShiftIds: Set<number> }
  >();

  for (const r of responses) {
    if (!respondentMap.has(r.respondentId)) {
      respondentMap.set(r.respondentId, {
        id: r.respondentId,
        name: r.respondentName,
        category: r.respondentCategory,
        availableShiftIds: new Set(),
      });
    }
    respondentMap.get(r.respondentId)!.availableShiftIds.add(r.shiftId);
  }

  const allRespondents = Array.from(respondentMap.values());
  const afpRespondents = allRespondents.filter((r) => r.category === "AFP");
  const generalRespondents = allRespondents.filter((r) => r.category === "General");

  // Track assigned shifts globally (each shift can only be assigned to one person)
  const assignedShiftIds = new Set<number>();
  const plans: AllocationPlan[] = [];

  // Helper: compute hours for a set of shift IDs
  function computeHours(shiftIds: number[]): number {
    return shiftIds.reduce((sum, id) => {
      const shift = shiftMap.get(id);
      return sum + (shift?.durationHours ?? 0);
    }, 0);
  }

  // Allocate AFP members first: each gets 3-4 hours from their available shifts
  for (const afp of afpRespondents) {
    const availableForAfp = Array.from(afp.availableShiftIds).filter(
      (id) => !assignedShiftIds.has(id)
    );

    // Sort by date to distribute across the month
    availableForAfp.sort((a, b) => {
      const sa = shiftMap.get(a)!;
      const sb = shiftMap.get(b)!;
      return sa.date.localeCompare(sb.date);
    });

    const allocated: number[] = [];
    let totalHours = 0;

    for (const shiftId of availableForAfp) {
      const shift = shiftMap.get(shiftId)!;
      if (totalHours + shift.durationHours <= afpMaxHours) {
        allocated.push(shiftId);
        totalHours += shift.durationHours;
        assignedShiftIds.add(shiftId);
      }
      if (totalHours >= afpMinHours) break;
    }

    // If not enough hours found, keep trying to fill up to max
    if (totalHours < afpMinHours) {
      for (const shiftId of availableForAfp) {
        if (allocated.includes(shiftId)) continue;
        const shift = shiftMap.get(shiftId)!;
        if (totalHours + shift.durationHours <= afpMaxHours + 1) {
          allocated.push(shiftId);
          totalHours += shift.durationHours;
          assignedShiftIds.add(shiftId);
        }
        if (totalHours >= afpMinHours) break;
      }
    }

    plans.push({
      respondentId: afp.id,
      name: afp.name,
      category: "AFP",
      shiftIds: allocated,
      totalHours,
      isManuallyAdjusted: false,
      penaltyNote: null,
    });
  }

  // Compute remaining unassigned shifts
  const remainingShifts = shifts.filter((s) => !assignedShiftIds.has(s.id));

  if (generalRespondents.length === 0) {
    const allAssigned = plans.map((p) => p.shiftIds).flat();
    const unallocated = shifts.map((s) => s.id).filter((id) => !allAssigned.includes(id));
    const hours = plans.map((p) => p.totalHours);
    const avg = hours.length > 0 ? hours.reduce((a, b) => a + b, 0) / hours.length : 0;
    return { plans, averageHours: avg, stdDev: stdDev(hours), unallocatedShiftIds: unallocated };
  }

  // Compute target hours per general respondent
  const totalRemainingHours = remainingShifts.reduce((sum, s) => sum + s.durationHours, 0);
  const targetHoursPerGeneral = totalRemainingHours / generalRespondents.length;

  // Assign general respondents iteratively using a greedy approach
  // Sort general respondents by availability (least available first to prioritize getting them shifts)
  const generalWithAvailability = generalRespondents.map((r) => {
    const available = Array.from(r.availableShiftIds).filter((id) => !assignedShiftIds.has(id));
    const availableHours = available.reduce((sum, id) => sum + (shiftMap.get(id)?.durationHours ?? 0), 0);
    return { ...r, availableHours };
  });

  // Sort by availability (ascending) so least available get priority
  generalWithAvailability.sort((a, b) => a.availableHours - b.availableHours);

  const generalAllocations = new Map<number, number[]>();
  for (const r of generalWithAvailability) {
    generalAllocations.set(r.id, []);
  }

  // Iterative greedy allocation: keep assigning until target is met for each person
  let maxIterations = 5;
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    for (const respondent of generalWithAvailability) {
      const currentAlloc = generalAllocations.get(respondent.id) ?? [];
      const currentHours = computeHours(currentAlloc);

      if (currentHours >= targetHoursPerGeneral) continue;

      const available = Array.from(respondent.availableShiftIds)
        .filter((id) => !assignedShiftIds.has(id))
        .sort((a, b) => {
          const sa = shiftMap.get(a)!;
          const sb = shiftMap.get(b)!;
          return sa.date.localeCompare(sb.date);
        });

      for (const shiftId of available) {
        const shift = shiftMap.get(shiftId)!;
        const newHours = currentHours + shift.durationHours;
        // Add shift if we're still below target + 1 std dev or if we have very few shifts
        if (newHours <= targetHoursPerGeneral * 1.5 || currentHours < targetHoursPerGeneral * 0.5) {
          currentAlloc.push(shiftId);
          assignedShiftIds.add(shiftId);
          changed = true;
          break;
        }
      }
    }

    if (!changed) break;
  }

  // Second pass: distribute remaining shifts to those below average
  const unassignedRemainingShifts = shifts.filter((s) => !assignedShiftIds.has(s.id));
  unassignedRemainingShifts.sort((a, b) => a.date.localeCompare(b.date));

  for (const shift of unassignedRemainingShifts) {
    // Find general respondent who can take this shift and is furthest below target
    let bestRespondent: (typeof generalWithAvailability)[0] | null = null;
    let bestScore = Infinity;

    for (const respondent of generalWithAvailability) {
      if (!respondent.availableShiftIds.has(shift.id)) continue;
      const currentAlloc = generalAllocations.get(respondent.id) ?? [];
      const currentHours = computeHours(currentAlloc);
      const score = currentHours;
      if (score < bestScore) {
        bestScore = score;
        bestRespondent = respondent;
      }
    }

    if (bestRespondent) {
      const alloc = generalAllocations.get(bestRespondent.id) ?? [];
      alloc.push(shift.id);
      assignedShiftIds.add(shift.id);
    }
  }

  // Build general plans
  for (const respondent of generalWithAvailability) {
    const shiftIds = generalAllocations.get(respondent.id) ?? [];
    plans.push({
      respondentId: respondent.id,
      name: respondent.name,
      category: "General",
      shiftIds,
      totalHours: computeHours(shiftIds),
      isManuallyAdjusted: false,
      penaltyNote: null,
    });
  }

  // Compute stats for General respondents
  const generalHours = plans.filter((p) => p.category === "General").map((p) => p.totalHours);
  const allHours = plans.map((p) => p.totalHours);
  const averageHours = allHours.length > 0 ? allHours.reduce((a, b) => a + b, 0) / allHours.length : 0;

  const unallocated = shifts.map((s) => s.id).filter((id) => !assignedShiftIds.has(id));

  return {
    plans,
    averageHours,
    stdDev: stdDev(allHours),
    unallocatedShiftIds: unallocated,
  };
}
