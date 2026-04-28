export type AssignmentSource =
  | "engine_normal"
  | "engine_back_to_back_emergency"
  | "engine_no_availability_afp_fallback"
  | "engine_afp_cap_overflow_available"
  | "manual"
  | "blank";

export type ExplanationCode =
  | "NO_AVAILABILITY"
  | "NO_FALLBACK_AFP_SELECTED"
  | "FALLBACK_AFP_BLOCKED_BY_SAME_DAY_RULE"
  | "BLOCKED_BY_NON_ADJACENT_SAME_DAY"
  | "BLOCKED_BY_MAX_TWO_SHIFTS_DAY"
  | "BLOCKED_BY_AFP_CAP"
  | "BLOCKED_ONLY_BY_AFP_CAP"
  | "BLOCKED_BY_MANUAL_LOCK"
  | "BLOCKED_BY_NO_BACK_TO_BACK_OPTION"
  | "NON_AFP_CAPACITY_SHORTFALL"
  | "INSUFFICIENT_AVAILABILITY"
  | "SHIFT_GRANULARITY"
  | "SAME_DAY_CONSTRAINT"
  | "AFP_CAP_INTERACTION"
  | "MANUAL_OVERRIDE"
  | "MANUAL_LOCK_CONSTRAINT"
  | "NO_AVAILABLE_ALTERNATIVE"
  | "ALL_RESPONDENTS_PENALIZED"
  | "ONLY_ONE_NON_AFP"
  | "TARGET_TRUNCATED_AT_ZERO"
  | "ENGINE_REPAIR_LIMIT_REACHED"
  | "RENDERING_ASSIGNMENT_MISMATCH"
  | "AVAILABILITY_SHIFT_KEY_MISMATCH"
  | "UNKNOWN";

export interface ShiftTimeWindow {
  date: string;
  startTime: string;
  endTime: string;
}

export interface CoreShift extends ShiftTimeWindow {
  id: number;
  durationHours: number;
  slotIndex?: number;
}

export interface PenaltyTargetInput {
  respondentId: number;
  penaltyMinutes: number;
  capacityMinutes: number;
}

export interface PenaltyTargetOutput extends PenaltyTargetInput {
  targetMinutes: number;
  targetTruncatedAtZero: boolean;
  capacityLimited: boolean;
}

export interface PenaltyTargetResult {
  baselineMinutes: number;
  targets: PenaltyTargetOutput[];
  requestedTotalMinutes: number;
  feasibleTotalMinutes: number;
  capacityShortfallMinutes: number;
}

export interface AssignmentValidationResult {
  ok: boolean;
  reasonCodes: ExplanationCode[];
  wouldBeBackToBackEmergency: boolean;
  wouldExceedAfpCap: boolean;
  wouldViolateAvailability: boolean;
  wouldCreateNonAdjacentSameDayDouble: boolean;
  wouldCreateTripleShiftDay: boolean;
}

export function hoursToMinutes(hours: number): number {
  return Math.max(0, Math.round(hours * 60));
}

export function minutesToHours(minutes: number): number {
  return minutes / 60;
}

export function isBackToBack(a: ShiftTimeWindow, b: ShiftTimeWindow): boolean {
  return a.date === b.date && (a.endTime === b.startTime || b.endTime === a.startTime);
}

export function stableShiftKey(shift: ShiftTimeWindow & { slotIndex?: number }): string {
  return `${shift.date}|${shift.startTime}|${shift.endTime}|${shift.slotIndex ?? 0}`;
}

export function deriveShiftSlotIndexes<T extends { id: number; date: string; startTime: string; endTime: string }>(
  shifts: T[],
): Map<number, number> {
  const byDate = new Map<string, T[]>();
  for (const shift of shifts) {
    byDate.set(shift.date, [...(byDate.get(shift.date) ?? []), shift]);
  }

  const slotIndexes = new Map<number, number>();
  for (const shiftsForDate of byDate.values()) {
    shiftsForDate
      .sort(
        (a, b) =>
          a.startTime.localeCompare(b.startTime) ||
          a.endTime.localeCompare(b.endTime) ||
          a.id - b.id,
      )
      .forEach((shift, index) => slotIndexes.set(shift.id, index));
  }
  return slotIndexes;
}

export function sameDayAllocationTier(
  newShiftId: number,
  existing: number[],
  shiftMap: Map<number, CoreShift>,
): 0 | 1 | 2 {
  const nextShift = shiftMap.get(newShiftId);
  if (!nextShift) return 2;

  const sameDayShiftIds = existing.filter((id) => shiftMap.get(id)?.date === nextShift.date);
  if (sameDayShiftIds.length === 0) return 0;

  if (
    sameDayShiftIds.length === 1 &&
    isBackToBack(nextShift, shiftMap.get(sameDayShiftIds[0])!)
  ) {
    return 1;
  }

  return 2;
}

export function canAssignShiftToRespondent({
  shiftId,
  existingShiftIds,
  shiftMap,
  isAvailable,
  assignmentSource,
  category,
  currentNormalMinutes = 0,
  afpCapMinutes = Infinity,
}: {
  shiftId: number;
  existingShiftIds: number[];
  shiftMap: Map<number, CoreShift>;
  isAvailable: boolean;
  assignmentSource: AssignmentSource;
  category: "AFP" | "General";
  currentNormalMinutes?: number;
  afpCapMinutes?: number;
}): AssignmentValidationResult {
  const shift = shiftMap.get(shiftId);
  const reasonCodes: ExplanationCode[] = [];

  if (!shift) {
    return {
      ok: false,
      reasonCodes: ["UNKNOWN"],
      wouldBeBackToBackEmergency: false,
      wouldExceedAfpCap: false,
      wouldViolateAvailability: false,
      wouldCreateNonAdjacentSameDayDouble: false,
      wouldCreateTripleShiftDay: false,
    };
  }

  const requiresAvailability =
    assignmentSource === "engine_normal" ||
    assignmentSource === "engine_back_to_back_emergency" ||
    assignmentSource === "engine_afp_cap_overflow_available";
  const wouldViolateAvailability = requiresAvailability && !isAvailable;
  if (requiresAvailability && !isAvailable) {
    reasonCodes.push("NO_AVAILABLE_ALTERNATIVE");
  }

  const dayTier = sameDayAllocationTier(shiftId, existingShiftIds, shiftMap);
  const sameDayCount = existingShiftIds.filter((id) => shiftMap.get(id)?.date === shift.date).length;
  const wouldCreateTripleShiftDay = sameDayCount >= 2;
  const wouldCreateNonAdjacentSameDayDouble = dayTier === 2 && !wouldCreateTripleShiftDay;
  if (dayTier === 2) {
    reasonCodes.push(
      sameDayCount >= 2 ? "BLOCKED_BY_MAX_TWO_SHIFTS_DAY" : "BLOCKED_BY_NON_ADJACENT_SAME_DAY",
    );
  }

  const wouldExceedAfpCap =
    category === "AFP" &&
    currentNormalMinutes + hoursToMinutes(shift.durationHours) > afpCapMinutes;
  if (
    category === "AFP" &&
    assignmentSource !== "engine_no_availability_afp_fallback" &&
    assignmentSource !== "engine_afp_cap_overflow_available" &&
    assignmentSource !== "manual" &&
    wouldExceedAfpCap
  ) {
    reasonCodes.push("BLOCKED_BY_AFP_CAP");
  }

  return {
    ok: reasonCodes.length === 0,
    reasonCodes,
    wouldBeBackToBackEmergency: dayTier === 1,
    wouldExceedAfpCap,
    wouldViolateAvailability,
    wouldCreateNonAdjacentSameDayDouble,
    wouldCreateTripleShiftDay,
  };
}

export function solveNonAfpPenaltyTargets(
  people: PenaltyTargetInput[],
  intendedTotalMinutes: number,
): PenaltyTargetResult {
  const requestedTotalMinutes = Math.max(0, intendedTotalMinutes);
  const normalizedPeople = people.map((person) => ({
    respondentId: person.respondentId,
    penaltyMinutes: Math.max(0, person.penaltyMinutes),
    capacityMinutes: Math.max(0, person.capacityMinutes),
  }));
  const totalCapacity = normalizedPeople.reduce((sum, person) => sum + person.capacityMinutes, 0);
  const feasibleTotalMinutes = Math.min(requestedTotalMinutes, totalCapacity);
  const capacityShortfallMinutes = requestedTotalMinutes - feasibleTotalMinutes;

  if (normalizedPeople.length === 0 || feasibleTotalMinutes === 0) {
    return {
      baselineMinutes: 0,
      targets: normalizedPeople.map((person) => ({
        ...person,
        targetMinutes: 0,
        targetTruncatedAtZero: person.penaltyMinutes > 0,
        capacityLimited: person.capacityMinutes === 0,
      })),
      requestedTotalMinutes,
      feasibleTotalMinutes,
      capacityShortfallMinutes,
    };
  }

  const maxPenalty = Math.max(...normalizedPeople.map((person) => person.penaltyMinutes));
  const maxCapacity = Math.max(...normalizedPeople.map((person) => person.capacityMinutes));
  let low = 0;
  let high = maxPenalty + feasibleTotalMinutes + maxCapacity + 1;

  const assignedAt = (baseline: number) =>
    normalizedPeople.reduce((sum, person) => {
      const rawTarget = Math.max(0, baseline - person.penaltyMinutes);
      return sum + Math.min(person.capacityMinutes, rawTarget);
    }, 0);

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (assignedAt(mid) < feasibleTotalMinutes) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const baselineMinutes = high;
  const targets = normalizedPeople.map((person) => {
    const rawTarget = Math.max(0, baselineMinutes - person.penaltyMinutes);
    const targetMinutes = Math.min(person.capacityMinutes, rawTarget);
    return {
      ...person,
      targetMinutes,
      targetTruncatedAtZero: baselineMinutes <= person.penaltyMinutes && person.penaltyMinutes > 0,
      capacityLimited: person.capacityMinutes < rawTarget,
    };
  });

  return {
    baselineMinutes,
    targets,
    requestedTotalMinutes,
    feasibleTotalMinutes,
    capacityShortfallMinutes,
  };
}
