import { db, shiftsTable, respondentsTable, responsesTable, allocationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface AllocationOptions {
  surveyId: number;
  afpRespondentIds: number[];
  includedRespondentIds?: number[];
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
  targetWdRatio: number,
  maxOverHours = 1
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
      if (totalHours + s.durationHours > targetHours + maxOverHours) continue;
      const newTotal = totalHours + s.durationHours;
      const overBy = newTotal - targetHours;
      if (overBy <= maxOverHours) {
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
  const { surveyId, afpRespondentIds, includedRespondentIds } = options;
  const afpIdSet = new Set(afpRespondentIds);
  const includedIdSet = includedRespondentIds?.length ? new Set(includedRespondentIds) : null;

  const shifts = await db.select().from(shiftsTable).where(eq(shiftsTable.surveyId, surveyId));
  const shiftMap = new Map(shifts.map((s) => [s.id, s as ShiftInfo]));

  const responses = await db
    .select({
      respondentId: responsesTable.respondentId,
      shiftId: responsesTable.shiftId,
      respondentName: respondentsTable.preferredName,
      respondentFullName: respondentsTable.name,
      respondentCategory: respondentsTable.category,
      hasPenalty: responsesTable.hasPenalty,
      penaltyHours: responsesTable.penaltyHours,
      afpHoursCap: responsesTable.afpHoursCap,
    })
    .from(responsesTable)
    .innerJoin(respondentsTable, eq(responsesTable.respondentId, respondentsTable.id))
    .where(eq(responsesTable.surveyId, surveyId));

  const respondentMap = new Map<number, {
    id: number;
    name: string;
    category: string;
    availableShiftIds: Set<number>;
    hasPenalty: boolean;
    penaltyHours: number;
    afpHoursCap: number;
  }>();
  for (const r of responses) {
    if (includedIdSet && !includedIdSet.has(r.respondentId)) {
      continue;
    }
    const category = afpIdSet.has(r.respondentId) || r.respondentCategory === "AFP" ? "AFP" : "General";
    const hasPenalty = Boolean(r.hasPenalty);
    const penaltyHours = hasPenalty ? Math.max(0, r.penaltyHours ?? 0) : 0;
    const afpHoursCap = Math.max(0, r.afpHoursCap ?? 10);
    if (!respondentMap.has(r.respondentId)) {
      respondentMap.set(r.respondentId, {
        id: r.respondentId,
        name: r.respondentName || r.respondentFullName || "Unknown",
        category,
        availableShiftIds: new Set(),
        hasPenalty,
        penaltyHours,
        afpHoursCap,
      });
    } else {
      const respondent = respondentMap.get(r.respondentId)!;
      respondent.category = category;
      respondent.hasPenalty = respondent.hasPenalty || hasPenalty;
      respondent.penaltyHours = Math.max(respondent.penaltyHours, penaltyHours);
      respondent.afpHoursCap = Math.max(0, afpHoursCap);
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
    const afpTargetHours = Math.max(0, afp.afpHoursCap || 10);
    const available = Array.from(afp.availableShiftIds)
      .filter((id) => !assignedShiftIds.has(id))
      .sort((a, b) => shiftMap.get(a)!.date.localeCompare(shiftMap.get(b)!.date));

    const allocated = allocateToTarget(afpTargetHours, available, assignedShiftIds, shiftMap, globalWdRatio, 0);
    let afpHours = calcHours(allocated, shiftMap);
    const minimumAfpTarget = Math.max(0, afpTargetHours - 2);
    if (afpHours < minimumAfpTarget) {
      for (const shiftId of available) {
        if (allocated.includes(shiftId) || assignedShiftIds.has(shiftId)) continue;
        const nextHours = afpHours + (shiftMap.get(shiftId)?.durationHours ?? 0);
        if (nextHours > afpTargetHours) continue;
        allocated.push(shiftId);
        afpHours = nextHours;
        if (afpHours >= minimumAfpTarget) break;
      }
    }

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
  const baseTargetPerGeneral = totalRemainingHours / generalRespondents.length;
  const penalizedGeneralRespondents = generalRespondents.filter((r) => r.hasPenalty && r.penaltyHours > 0);
  const regularGeneralRespondents = generalRespondents.filter((r) => !(r.hasPenalty && r.penaltyHours > 0));
  const penalizedTargets = new Map(
    penalizedGeneralRespondents.map((r) => [r.id, Math.max(0, baseTargetPerGeneral - r.penaltyHours)]),
  );
  const regularTargetHours = regularGeneralRespondents.length > 0
    ? Math.max(
      0,
      (totalRemainingHours - Array.from(penalizedTargets.values()).reduce((sum, value) => sum + value, 0)) /
        regularGeneralRespondents.length,
    )
    : baseTargetPerGeneral;
  const targetByRespondentId = new Map<number, number>();
  for (const respondent of generalRespondents) {
    targetByRespondentId.set(
      respondent.id,
      penalizedTargets.get(respondent.id) ?? regularTargetHours,
    );
  }

  const generalAllocations = new Map<number, number[]>();
  for (const r of generalRespondents) generalAllocations.set(r.id, []);

  const sortedByAvailability = [...generalRespondents].sort((a, b) => {
    const aHrs = Array.from(a.availableShiftIds).filter((id) => !assignedShiftIds.has(id))
      .reduce((s, id) => s + (shiftMap.get(id)?.durationHours ?? 0), 0);
    const bHrs = Array.from(b.availableShiftIds).filter((id) => !assignedShiftIds.has(id))
      .reduce((s, id) => s + (shiftMap.get(id)?.durationHours ?? 0), 0);
    return aHrs - bHrs || a.name.localeCompare(b.name);
  });

  const eligibleGeneralCount = (shiftId: number) =>
    sortedByAvailability.filter((r) => r.availableShiftIds.has(shiftId)).length;

  const remainingShiftIds = remainingShifts
    .map((s) => s.id)
    .sort((a, b) => {
      const eligibleDiff = eligibleGeneralCount(a) - eligibleGeneralCount(b);
      if (eligibleDiff !== 0) return eligibleDiff;
      const durationDiff = shiftMap.get(b)!.durationHours - shiftMap.get(a)!.durationHours;
      if (durationDiff !== 0) return durationDiff;
      return `${shiftMap.get(a)!.date}-${shiftMap.get(a)!.startTime}`.localeCompare(
        `${shiftMap.get(b)!.date}-${shiftMap.get(b)!.startTime}`,
      );
    });

  for (const shiftId of remainingShiftIds) {
    if (assignedShiftIds.has(shiftId)) continue;

    const shift = shiftMap.get(shiftId)!;
    let bestRespondent: typeof sortedByAvailability[0] | null = null;
    let bestScore = Infinity;

    for (const respondent of sortedByAvailability) {
      if (!respondent.availableShiftIds.has(shiftId)) continue;

      const current = generalAllocations.get(respondent.id)!;
      const currentHours = calcHours(current, shiftMap);
      const afterHours = currentHours + shift.durationHours;
      const respondentTargetHours = targetByRespondentId.get(respondent.id) ?? baseTargetPerGeneral;
      const currentLoadPenalty = currentHours * 100;
      const overTargetPenalty = Math.max(0, afterHours - respondentTargetHours) * 140;
      const targetDistancePenalty = Math.abs(afterHours - respondentTargetHours) * 5;
      const backToBackPenalty = addsBackToBack(shiftId, current, shiftMap) ? 25 : 0;
      const ratioBonus = scoreShiftForPerson(shiftId, current, shiftMap, globalWdRatio);
      const score = currentLoadPenalty + overTargetPenalty + targetDistancePenalty + backToBackPenalty - ratioBonus;

      if (score < bestScore) {
        bestScore = score;
        bestRespondent = respondent;
      }
    }

    if (bestRespondent) {
      generalAllocations.get(bestRespondent.id)!.push(shiftId);
      assignedShiftIds.add(shiftId);
    }
  }

  const trackedRespondents = regularGeneralRespondents.length > 0
    ? sortedByAvailability.filter((r) => !(r.hasPenalty && r.penaltyHours > 0))
    : sortedByAvailability;

  const generalHours = () =>
    trackedRespondents.map((r) => calcHours(generalAllocations.get(r.id)!, shiftMap));

  const getMoveAdjustedHours = (fromId: number, toId: number, shiftId: number) =>
    trackedRespondents.map((r) => {
      const current = calcHours(generalAllocations.get(r.id)!, shiftMap);
      if (r.id === fromId) return current - shiftMap.get(shiftId)!.durationHours;
      if (r.id === toId) return current + shiftMap.get(shiftId)!.durationHours;
      return current;
    });

  let improved = true;
  let rebalancePasses = 0;
  const maxRebalancePasses = Math.max(100, remainingShiftIds.length * generalRespondents.length);

  while (improved && rebalancePasses < maxRebalancePasses) {
    improved = false;
    rebalancePasses++;

    const currentHours = generalHours();
    const currentStdDev = stdDev(currentHours);
    let bestMove: { fromId: number; toId: number; shiftId: number; nextStdDev: number } | null = null;

    for (const from of sortedByAvailability) {
      const fromShiftIds = generalAllocations.get(from.id)!;
      const fromHours = calcHours(fromShiftIds, shiftMap);

      for (const shiftId of fromShiftIds) {
        const shift = shiftMap.get(shiftId)!;

        for (const to of sortedByAvailability) {
          if (to.id === from.id) continue;
          if (!to.availableShiftIds.has(shiftId)) continue;

          const toShiftIds = generalAllocations.get(to.id)!;
          const toHours = calcHours(toShiftIds, shiftMap);
          if (fromHours <= toHours) continue;
          if (addsBackToBack(shiftId, toShiftIds, shiftMap)) continue;

          const nextStdDev = stdDev(getMoveAdjustedHours(from.id, to.id, shiftId));
          if (nextStdDev < currentStdDev - 0.01) {
            const existingBest = bestMove?.nextStdDev ?? Infinity;
            const fromTarget = targetByRespondentId.get(from.id) ?? baseTargetPerGeneral;
            const toTarget = targetByRespondentId.get(to.id) ?? baseTargetPerGeneral;
            const targetImprovement =
              Math.abs(fromHours - fromTarget) + Math.abs(toHours - toTarget) -
              (Math.abs(fromHours - shift.durationHours - fromTarget) +
                Math.abs(toHours + shift.durationHours - toTarget));

            if (nextStdDev < existingBest - 0.01 || (Math.abs(nextStdDev - existingBest) <= 0.01 && targetImprovement > 0)) {
              bestMove = { fromId: from.id, toId: to.id, shiftId, nextStdDev };
            }
          }
        }
      }
    }

    if (bestMove) {
      const fromShiftIds = generalAllocations.get(bestMove.fromId)!;
      generalAllocations.set(
        bestMove.fromId,
        fromShiftIds.filter((id) => id !== bestMove.shiftId),
      );
      generalAllocations.get(bestMove.toId)!.push(bestMove.shiftId);
      improved = true;
    }
  }

  for (const r of sortedByAvailability) {
    const shiftIds = generalAllocations.get(r.id)!.sort((a, b) =>
      `${shiftMap.get(a)!.date}-${shiftMap.get(a)!.startTime}`.localeCompare(
        `${shiftMap.get(b)!.date}-${shiftMap.get(b)!.startTime}`,
      ),
    );

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
