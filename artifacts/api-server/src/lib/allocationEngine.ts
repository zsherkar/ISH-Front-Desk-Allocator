import { db, shiftsTable, respondentsTable, responsesTable, allocationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  hoursToMinutes,
  isBackToBack,
  minutesToHours,
  sameDayAllocationTier,
  solveNonAfpPenaltyTargets,
} from "./allocationCore.js";
import { safeDisplayName } from "./inputValidation.js";

export interface AllocationOptions {
  surveyId: number;
  afpRespondentIds: number[];
  afpUnclaimedShiftRespondentIds?: number[];
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
      if (isBackToBack(a, b)) {
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
    if (isBackToBack(ns, s)) {
      return true;
    }
  }
  return false;
}

function canAddShiftOnDay(
  newShiftId: number,
  existing: number[],
  shiftMap: Map<number, ShiftInfo>,
): boolean {
  return sameDayAllocationTier(newShiftId, existing, shiftMap) < 2;
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
  if (sameDayAllocationTier(shiftId, allocated, shiftMap) === 1) score -= 120;
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

  const addBestShift = (dayTier: 0 | 1): boolean => {
    let best: number | null = null;
    let bestScore = -Infinity;

    for (const id of candidates) {
      if (allocated.includes(id)) continue;
      if (assignedShiftIds.has(id)) continue;
      const s = shiftMap.get(id)!;
      if (totalHours + s.durationHours > targetHours) continue;
      if (sameDayAllocationTier(id, allocated, shiftMap) !== dayTier) continue;

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
    if (!addBestShift(0)) {
      if (!addBestShift(1)) break;
    }
  }

  if (totalHours < targetHours) {
    for (const dayTier of [0, 1] as const) {
      let didAdd = false;
      for (const id of candidates) {
        if (allocated.includes(id)) continue;
        if (assignedShiftIds.has(id)) continue;
        if (sameDayAllocationTier(id, allocated, shiftMap) !== dayTier) continue;
        const s = shiftMap.get(id)!;
        if (totalHours + s.durationHours > targetHours + maxOverHours) continue;
        const newTotal = totalHours + s.durationHours;
        const overBy = newTotal - targetHours;
        if (overBy <= maxOverHours) {
          allocated.push(id);
          totalHours = newTotal;
          didAdd = true;
          break;
        }
      }
      if (didAdd) break;
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
  const { surveyId, afpRespondentIds, afpUnclaimedShiftRespondentIds, includedRespondentIds } = options;
  const afpIdSet = new Set(afpRespondentIds);
  const afpUnclaimedShiftIdSet = new Set(afpUnclaimedShiftRespondentIds ?? []);
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
        name: safeDisplayName(r.respondentName, r.respondentFullName),
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
  const afpUnclaimedShiftRespondents = afpRespondents.filter((r) => afpUnclaimedShiftIdSet.has(r.id));

  const assignedShiftIds = new Set<number>();
  const plans: AllocationPlan[] = [];
  const afpAllocations = new Map<number, number[]>();

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
        if (!canAddShiftOnDay(shiftId, allocated, shiftMap)) continue;
        const nextHours = afpHours + (shiftMap.get(shiftId)?.durationHours ?? 0);
        if (nextHours > afpTargetHours) continue;
        allocated.push(shiftId);
        afpHours = nextHours;
        if (afpHours >= minimumAfpTarget) break;
      }
    }

    for (const id of allocated) assignedShiftIds.add(id);
    afpAllocations.set(afp.id, allocated);
  }

  if (generalRespondents.length === 0) {
    for (const shift of shifts) {
      if (assignedShiftIds.has(shift.id)) continue;
      const selectedByAnyone = allRespondents.some((respondent) => respondent.availableShiftIds.has(shift.id));
      if (selectedByAnyone) continue;

      const best = afpUnclaimedShiftRespondents
        .map((respondent) => {
          const current = afpAllocations.get(respondent.id) ?? [];
          return {
            respondent,
            current,
            currentHours: calcHours(current, shiftMap),
            dayTier: sameDayAllocationTier(shift.id, current, shiftMap),
          };
        })
        .filter((candidate) => candidate.dayTier < 2)
        .sort((a, b) => a.dayTier - b.dayTier || a.currentHours - b.currentHours || a.respondent.name.localeCompare(b.respondent.name))[0];

      if (best) {
        afpAllocations.set(best.respondent.id, [...best.current, shift.id]);
        assignedShiftIds.add(shift.id);
      }
    }

    for (const afp of afpRespondents) {
      const shiftIds = afpAllocations.get(afp.id) ?? [];
      plans.push({
        respondentId: afp.id,
        name: afp.name,
        category: "AFP",
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

  const remainingShifts = shifts.filter((s) => !assignedShiftIds.has(s.id));
  const generalAssignableShifts = remainingShifts.filter((shift) =>
    generalRespondents.some((respondent) => respondent.availableShiftIds.has(shift.id)),
  );
  const generalAssignableShiftIds = new Set(generalAssignableShifts.map((shift) => shift.id));
  const totalRemainingHours = generalAssignableShifts.reduce((s, sh) => s + sh.durationHours, 0);
  const regularGeneralRespondents = generalRespondents.filter((r) => !(r.hasPenalty && r.penaltyHours > 0));
  const targetResult = solveNonAfpPenaltyTargets(
    generalRespondents.map((respondent) => ({
      respondentId: respondent.id,
      penaltyMinutes: hoursToMinutes(respondent.hasPenalty ? respondent.penaltyHours : 0),
      capacityMinutes: Array.from(respondent.availableShiftIds)
        .filter((id) => generalAssignableShiftIds.has(id))
        .reduce((sum, id) => sum + hoursToMinutes(shiftMap.get(id)?.durationHours ?? 0), 0),
    })),
    hoursToMinutes(totalRemainingHours),
  );
  const regularTargetHours = minutesToHours(targetResult.baselineMinutes);
  const penaltyTargetByRespondentId = new Map(
    targetResult.targets.map((target) => [target.respondentId, minutesToHours(target.targetMinutes)]),
  );
  const targetByRespondentId = new Map<number, number>();
  for (const respondent of generalRespondents) {
    targetByRespondentId.set(
      respondent.id,
      penaltyTargetByRespondentId.get(respondent.id) ?? regularTargetHours,
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
    const eligibleCandidates = sortedByAvailability
      .filter((respondent) => respondent.availableShiftIds.has(shiftId))
      .map((respondent) => {
        const current = generalAllocations.get(respondent.id)!;
        const currentHours = calcHours(current, shiftMap);
        const afterHours = currentHours + shift.durationHours;
        const respondentTargetHours = targetByRespondentId.get(respondent.id) ?? regularTargetHours;
        return {
          respondent,
          current,
          currentHours,
          afterHours,
          respondentTargetHours,
          dayTier: sameDayAllocationTier(shiftId, current, shiftMap),
          isPenalized: respondent.hasPenalty && respondent.penaltyHours > 0,
        };
      })
      .filter((candidate) => candidate.dayTier < 2);

    if (eligibleCandidates.length === 0) continue;

    const bestDayTier = Math.min(...eligibleCandidates.map((candidate) => candidate.dayTier));
    let candidatePool = eligibleCandidates.filter((candidate) => candidate.dayTier === bestDayTier);
    const underTargetCandidates = candidatePool.filter(
      (candidate) => candidate.afterHours <= candidate.respondentTargetHours + 0.01,
    );
    if (underTargetCandidates.length > 0) {
      candidatePool = underTargetCandidates;
    } else {
      const regularCandidates = candidatePool.filter((candidate) => !candidate.isPenalized);
      if (regularCandidates.length > 0) {
        candidatePool = regularCandidates;
      }
    }

    for (const candidate of candidatePool) {
      const currentLoadPenalty = candidate.currentHours * 10;
      const overTargetPenalty = Math.max(0, candidate.afterHours - candidate.respondentTargetHours) * 500;
      const targetDistancePenalty = Math.abs(candidate.afterHours - candidate.respondentTargetHours) * 40;
      const sameDayPenalty = candidate.dayTier * 1000;
      const backToBackPenalty = addsBackToBack(shiftId, candidate.current, shiftMap) ? 200 : 0;
      const penalizedOverTargetPenalty =
        candidate.isPenalized && candidate.afterHours > candidate.respondentTargetHours + 0.01 ? 3000 : 0;
      const ratioBonus = scoreShiftForPerson(shiftId, candidate.current, shiftMap, globalWdRatio);
      const score =
        currentLoadPenalty +
        overTargetPenalty +
        targetDistancePenalty +
        sameDayPenalty +
        backToBackPenalty +
        penalizedOverTargetPenalty -
        ratioBonus;

      if (score < bestScore) {
        bestScore = score;
        bestRespondent = candidate.respondent;
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
        const hasNoSameDayRecipient = sortedByAvailability.some((candidate) => {
          if (candidate.id === from.id) return false;
          if (!candidate.availableShiftIds.has(shiftId)) return false;
          return sameDayAllocationTier(shiftId, generalAllocations.get(candidate.id)!, shiftMap) === 0;
        });

        for (const to of sortedByAvailability) {
          if (to.id === from.id) continue;
          if (!to.availableShiftIds.has(shiftId)) continue;

          const toShiftIds = generalAllocations.get(to.id)!;
          const toHours = calcHours(toShiftIds, shiftMap);
          if (fromHours <= toHours) continue;
          const toDayTier = sameDayAllocationTier(shiftId, toShiftIds, shiftMap);
          if (toDayTier >= 2) continue;
          if (toDayTier === 1 && hasNoSameDayRecipient) continue;
          const toTarget = targetByRespondentId.get(to.id) ?? regularTargetHours;
          if (
            regularGeneralRespondents.length > 0 &&
            to.hasPenalty &&
            to.penaltyHours > 0 &&
            toHours + shift.durationHours > toTarget + 0.01
          ) {
            continue;
          }

          const nextStdDev = stdDev(getMoveAdjustedHours(from.id, to.id, shiftId));
          if (nextStdDev < currentStdDev - 0.01) {
            const existingBest = bestMove?.nextStdDev ?? Infinity;
            const fromTarget = targetByRespondentId.get(from.id) ?? regularTargetHours;
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

  const assignFallbackShift = (
    shiftId: number,
    respondents: typeof allRespondents,
    allocationMap: Map<number, number[]>,
    requireAvailability: boolean,
    allowAfpCapOverage: boolean,
  ): boolean => {
    const shift = shiftMap.get(shiftId)!;
    const candidates = respondents
      .filter((respondent) => !requireAvailability || respondent.availableShiftIds.has(shiftId))
      .map((respondent) => {
        const current = allocationMap.get(respondent.id) ?? [];
        const currentHours = calcHours(current, shiftMap);
        const afterHours = currentHours + shift.durationHours;
        const targetHours = targetByRespondentId.get(respondent.id) ?? regularTargetHours;
        return {
          respondent,
          current,
          currentHours,
          afterHours,
          targetHours,
          capBlocked:
            respondent.category === "AFP" &&
            !allowAfpCapOverage &&
            afterHours > respondent.afpHoursCap + 0.01,
          dayTier: sameDayAllocationTier(shiftId, current, shiftMap),
          isPenalized: respondent.hasPenalty && respondent.penaltyHours > 0,
        };
      })
      .filter((candidate) => candidate.dayTier < 2 && !candidate.capBlocked);

    if (candidates.length === 0) return false;

    const bestDayTier = Math.min(...candidates.map((candidate) => candidate.dayTier));
    const best = candidates
      .filter((candidate) => candidate.dayTier === bestDayTier)
      .sort((a, b) => {
        const penalizedOverTargetDiff =
          Number(a.isPenalized && a.afterHours > a.targetHours + 0.01) -
          Number(b.isPenalized && b.afterHours > b.targetHours + 0.01);
        if (penalizedOverTargetDiff !== 0) return penalizedOverTargetDiff;

        const overTargetDiff =
          Math.max(0, a.afterHours - a.targetHours) - Math.max(0, b.afterHours - b.targetHours);
        if (Math.abs(overTargetDiff) > 0.01) return overTargetDiff;

        return a.currentHours - b.currentHours || a.respondent.name.localeCompare(b.respondent.name);
      })[0];

    if (!best) return false;
    allocationMap.set(best.respondent.id, [...best.current, shiftId]);
    assignedShiftIds.add(shiftId);
    return true;
  };

  for (const shift of shifts) {
    if (assignedShiftIds.has(shift.id)) continue;
    if (generalRespondents.some((respondent) => respondent.availableShiftIds.has(shift.id))) {
      assignFallbackShift(shift.id, generalRespondents, generalAllocations, true, false);
    }
  }

  for (const shift of shifts) {
    if (assignedShiftIds.has(shift.id)) continue;
    const selectedByAnyone = allRespondents.some((respondent) => respondent.availableShiftIds.has(shift.id));
    if (selectedByAnyone) {
      assignFallbackShift(shift.id, afpRespondents, afpAllocations, true, false);
    }
  }

  for (const shift of shifts) {
    if (assignedShiftIds.has(shift.id)) continue;
    const selectedByAnyone = allRespondents.some((respondent) => respondent.availableShiftIds.has(shift.id));
    if (!selectedByAnyone) {
      assignFallbackShift(shift.id, afpUnclaimedShiftRespondents, afpAllocations, false, true);
    }
  }

  for (const afp of afpRespondents) {
    const shiftIds = (afpAllocations.get(afp.id) ?? []).sort((a, b) =>
      `${shiftMap.get(a)!.date}-${shiftMap.get(a)!.startTime}`.localeCompare(
        `${shiftMap.get(b)!.date}-${shiftMap.get(b)!.startTime}`,
      ),
    );

    plans.push({
      respondentId: afp.id,
      name: afp.name,
      category: "AFP",
      shiftIds,
      totalHours: calcHours(shiftIds, shiftMap),
      isManuallyAdjusted: false,
      penaltyNote: null,
    });
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
