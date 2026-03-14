import { db, shiftsTable, respondentsTable, responsesTable, allocationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface AllocationOptions {
  surveyId: number;
  afpRespondentIds: number[];
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

interface ShiftInfo {
  id: number;
  date: string;
  dayType: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  label: string;
}

function calcHours(shiftIds: number[], shiftMap: Map<number, ShiftInfo>): number {
  return shiftIds.reduce((sum, id) => sum + (shiftMap.get(id)?.durationHours ?? 0), 0);
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function countBackToBack(shiftIds: number[], shiftMap: Map<number, ShiftInfo>): number {
  let count = 0;
  for (let i = 0; i < shiftIds.length; i++) {
    const a = shiftMap.get(shiftIds[i])!;
    for (let j = i + 1; j < shiftIds.length; j++) {
      const b = shiftMap.get(shiftIds[j])!;
      if (a.date === b.date && (a.endTime === b.startTime || b.endTime === a.startTime)) {
        count++;
      }
    }
  }
  return count;
}

function addsBackToBack(newShiftId: number, existing: number[], shiftMap: Map<number, ShiftInfo>): boolean {
  const ns = shiftMap.get(newShiftId)!;
  for (const id of existing) {
    const s = shiftMap.get(id)!;
    if (s.date === ns.date && (s.endTime === ns.startTime || ns.endTime === s.startTime)) {
      return true;
    }
  }
  return false;
}

function weekdayWeekendRatio(shiftIds: number[], shiftMap: Map<number, ShiftInfo>): number {
  const wdh = shiftIds.reduce((s, id) => s + (shiftMap.get(id)?.dayType === "weekday" ? shiftMap.get(id)!.durationHours : 0), 0);
  const weh = shiftIds.reduce((s, id) => s + (shiftMap.get(id)?.dayType === "weekend" ? shiftMap.get(id)!.durationHours : 0), 0);
  const total = wdh + weh;
  return total > 0 ? wdh / total : 0.5;
}

function scoreShiftForPerson(
  shiftId: number,
  allocated: number[],
  shiftMap: Map<number, ShiftInfo>,
  targetWdRatio: number
): number {
  let score = 0;
  if (addsBackToBack(shiftId, allocated, shiftMap)) score -= 80;
  const shift = shiftMap.get(shiftId)!;
  const currentRatio = weekdayWeekendRatio(allocated, shiftMap);
  const afterRatio = weekdayWeekendRatio([...allocated, shiftId], shiftMap);
  const improved = Math.abs(afterRatio - targetWdRatio) < Math.abs(currentRatio - targetWdRatio);
  if (improved) score += 30;
  score -= shift.date.localeCompare(shift.date) * 0;
  return score;
}

function allocateToTarget(
  targetHours: number,
  availableShiftIds: number[],
  assignedShiftIds: Set<number>,
  shiftMap: Map<number, ShiftInfo>,
  targetWdRatio: number
): number[] {
  const candidates = availableShiftIds
    .filter((id) => !assignedShiftIds.has(id))
    .sort((a, b) => shiftMap.get(a)!.date.localeCompare(shiftMap.get(b)!.date));

  const allocated: number[] = [];
  let totalHours = 0;

  const addBestShift = (allowBackToBack: boolean): boolean => {
    let best: number | null = null;
    let bestScore = -Infinity;

    for (const id of candidates) {
      if (allocated.includes(id)) continue;
      if (assignedShiftIds.has(id)) continue;
      const s = shiftMap.get(id)!;
      if (totalHours + s.durationHours > targetHours) continue;
      if (!allowBackToBack && addsBackToBack(id, allocated, shiftMap)) continue;

      const score = scoreShiftForPerson(id, allocated, shiftMap, targetWdRatio);
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }

    if (best !== null) {
      allocated.push(best);
      totalHours += shiftMap.get(best)!.durationHours;
      return true;
    }
    return false;
  };

  while (totalHours < targetHours) {
    if (!addBestShift(false)) {
      if (!addBestShift(true)) break;
    }
  }

  if (totalHours < targetHours) {
    for (const id of candidates) {
      if (allocated.includes(id)) continue;
      if (assignedShiftIds.has(id)) continue;
      const s = shiftMap.get(id)!;
      if (totalHours + s.durationHours > targetHours + s.durationHours) continue;
      const newTotal = totalHours + s.durationHours;
      const overBy = newTotal - targetHours;
      if (overBy <= 1) {
        allocated.push(id);
        totalHours = newTotal;
        break;
      }
    }
  }

  return allocated;
}

export async function runAllocation(options: AllocationOptions): Promise<{
  plans: AllocationPlan[];
  averageHours: number;
  stdDev: number;
  unallocatedShiftIds: number[];
}> {
  const { surveyId, afpRespondentIds } = options;
  const afpIdSet = new Set(afpRespondentIds);

  const shifts = await db.select().from(shiftsTable).where(eq(shiftsTable.surveyId, surveyId));
  const shiftMap = new Map(shifts.map((s) => [s.id, s as ShiftInfo]));

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

  const respondentMap = new Map<number, { id: number; name: string; category: string; availableShiftIds: Set<number> }>();
  for (const r of responses) {
    if (!respondentMap.has(r.respondentId)) {
      const category = afpIdSet.has(r.respondentId) ? "AFP" : "General";
      respondentMap.set(r.respondentId, {
        id: r.respondentId,
        name: r.respondentName,
        category,
        availableShiftIds: new Set(),
      });
    } else {
      respondentMap.get(r.respondentId)!.category = afpIdSet.has(r.respondentId) ? "AFP" : "General";
    }
    respondentMap.get(r.respondentId)!.availableShiftIds.add(r.shiftId);
  }

  const allRespondents = Array.from(respondentMap.values());
  const afpRespondents = allRespondents.filter((r) => r.category === "AFP");
  const generalRespondents = allRespondents.filter((r) => r.category === "General");

  const assignedShiftIds = new Set<number>();
  const plans: AllocationPlan[] = [];

  const totalShiftHours = shifts.reduce((s, sh) => s + sh.durationHours, 0);
  const weekdayHours = shifts.filter((s) => s.dayType === "weekday").reduce((s, sh) => s + sh.durationHours, 0);
  const globalWdRatio = totalShiftHours > 0 ? weekdayHours / totalShiftHours : 0.5;

  for (const afp of afpRespondents) {
    const available = Array.from(afp.availableShiftIds)
      .filter((id) => !assignedShiftIds.has(id))
      .sort((a, b) => shiftMap.get(a)!.date.localeCompare(shiftMap.get(b)!.date));

    const allocated = allocateToTarget(10, available, assignedShiftIds, shiftMap, globalWdRatio);

    for (const id of allocated) assignedShiftIds.add(id);

    plans.push({
      respondentId: afp.id,
      name: afp.name,
      category: "AFP",
      shiftIds: allocated,
      totalHours: calcHours(allocated, shiftMap),
      isManuallyAdjusted: false,
      penaltyNote: null,
    });
  }

  if (generalRespondents.length === 0) {
    const allHrs = plans.map((p) => p.totalHours);
    const avg = allHrs.length > 0 ? allHrs.reduce((a, b) => a + b, 0) / allHrs.length : 0;
    const unallocated = shifts.map((s) => s.id).filter((id) => !assignedShiftIds.has(id));
    return { plans, averageHours: avg, stdDev: stdDev(allHrs), unallocatedShiftIds: unallocated };
  }

  const remainingShifts = shifts.filter((s) => !assignedShiftIds.has(s.id));
  const totalRemainingHours = remainingShifts.reduce((s, sh) => s + sh.durationHours, 0);
  const targetPerGeneral = totalRemainingHours / generalRespondents.length;

  const generalAllocations = new Map<number, number[]>();
  for (const r of generalRespondents) generalAllocations.set(r.id, []);

  const sortedByAvailability = [...generalRespondents].sort((a, b) => {
    const aHrs = Array.from(a.availableShiftIds).filter((id) => !assignedShiftIds.has(id))
      .reduce((s, id) => s + (shiftMap.get(id)?.durationHours ?? 0), 0);
    const bHrs = Array.from(b.availableShiftIds).filter((id) => !assignedShiftIds.has(id))
      .reduce((s, id) => s + (shiftMap.get(id)?.durationHours ?? 0), 0);
    return aHrs - bHrs;
  });

  const unassigned = remainingShifts
    .map((s) => s.id)
    .sort((a, b) => shiftMap.get(a)!.date.localeCompare(shiftMap.get(b)!.date));

  let passes = 0;
  const maxPasses = unassigned.length * 2;

  while (passes < maxPasses) {
    passes++;

    let bestRespondent: typeof sortedByAvailability[0] | null = null;
    let bestHours = Infinity;

    for (const r of sortedByAvailability) {
      const hrs = calcHours(generalAllocations.get(r.id)!, shiftMap);
      if (hrs < targetPerGeneral && hrs < bestHours) {
        const canTake = unassigned.some((id) => !assignedShiftIds.has(id) && r.availableShiftIds.has(id));
        if (canTake) {
          bestHours = hrs;
          bestRespondent = r;
        }
      }
    }

    if (!bestRespondent) break;

    const current = generalAllocations.get(bestRespondent.id)!;

    let bestShift: number | null = null;
    let bestScore = -Infinity;

    for (const id of unassigned) {
      if (assignedShiftIds.has(id)) continue;
      if (!bestRespondent.availableShiftIds.has(id)) continue;
      const s = shiftMap.get(id)!;
      if (calcHours(current, shiftMap) + s.durationHours > targetPerGeneral * 1.6) continue;

      const score = scoreShiftForPerson(id, current, shiftMap, globalWdRatio);
      if (score > bestScore) {
        bestScore = score;
        bestShift = id;
      }
    }

    if (bestShift === null) break;

    current.push(bestShift);
    assignedShiftIds.add(bestShift);
  }

  const leftoverShifts = shifts.filter((s) => !assignedShiftIds.has(s.id));
  leftoverShifts.sort((a, b) => a.date.localeCompare(b.date));

  for (const shift of leftoverShifts) {
    let bestR: typeof sortedByAvailability[0] | null = null;
    let lowestHrs = Infinity;

    for (const r of sortedByAvailability) {
      if (!r.availableShiftIds.has(shift.id)) continue;
      const hrs = calcHours(generalAllocations.get(r.id)!, shiftMap);
      if (hrs < lowestHrs) {
        lowestHrs = hrs;
        bestR = r;
      }
    }

    if (bestR) {
      generalAllocations.get(bestR.id)!.push(shift.id);
      assignedShiftIds.add(shift.id);
    }
  }

  const generalHours = sortedByAvailability.map((r) => calcHours(generalAllocations.get(r.id)!, shiftMap));
  const generalMean = generalHours.length > 0 ? generalHours.reduce((a, b) => a + b, 0) / generalHours.length : 0;
  const generalSD = stdDev(generalHours);
  const upperBound = generalMean + generalSD;

  for (const r of sortedByAvailability) {
    const shiftIds = generalAllocations.get(r.id)!;
    let hrs = calcHours(shiftIds, shiftMap);
    if (hrs > upperBound && generalSD > 0) {
      shiftIds.sort((a, b) => {
        const ba = addsBackToBack(a, shiftIds.filter((id) => id !== a), shiftMap) ? 1 : 0;
        const bb = addsBackToBack(b, shiftIds.filter((id) => id !== b), shiftMap) ? 1 : 0;
        return bb - ba;
      });
      while (hrs > upperBound + 1 && shiftIds.length > 0) {
        const removed = shiftIds.pop()!;
        assignedShiftIds.delete(removed);
        hrs = calcHours(shiftIds, shiftMap);
      }
    }

    plans.push({
      respondentId: r.id,
      name: r.name,
      category: "General",
      shiftIds,
      totalHours: calcHours(shiftIds, shiftMap),
      isManuallyAdjusted: false,
      penaltyNote: null,
    });
  }

  const allHrs = plans.map((p) => p.totalHours);
  const avg = allHrs.length > 0 ? allHrs.reduce((a, b) => a + b, 0) / allHrs.length : 0;
  const unallocated = shifts.map((s) => s.id).filter((id) => !assignedShiftIds.has(id));

  return { plans, averageHours: avg, stdDev: stdDev(allHrs), unallocatedShiftIds: unallocated };
}
