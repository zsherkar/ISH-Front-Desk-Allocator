import type {
  AllocationAssignment,
  PureAllocationInput,
  PureAllocationOutput,
} from "./allocationEngine.js";

export interface AllocationValidationIssue {
  code: string;
  message: string;
  respondentId?: number;
  shiftId?: number;
}

export class AllocationValidationError extends Error {
  constructor(public readonly issues: AllocationValidationIssue[]) {
    super(
      `Allocation failed validation: ${issues.map((issue) => issue.code).join(", ")}`,
    );
    this.name = "AllocationValidationError";
  }
}

const normalSources = new Set([
  "engine_normal",
  "engine_back_to_back_emergency",
  "engine_afp_cap_overflow_available",
  "manual",
]);
const placeholderSources = new Set([
  "admin_no_availability_afp_placeholder",
  "engine_no_availability_afp_fallback",
]);
const near = (a: number, b: number) =>
  Number.isFinite(a) && Math.abs(a - b) < 1e-6;
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;

/** Validate before maps, minute rounding, or optimizer normalization can hide bad input. */
export function validateAllocationInput(
  input: PureAllocationInput,
): AllocationValidationIssue[] {
  const issues: AllocationValidationIssue[] = [];
  const report = (
    code: string,
    message: string,
    context: { respondentId?: number; shiftId?: number } = {},
  ) => issues.push({ code, message, ...context });
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const respondents = new Map(
    input.respondents.map((respondent) => [respondent.id, respondent]),
  );
  const seenShiftIds = new Set<number>();
  for (const shift of input.shifts) {
    if (!validId(shift.id) || seenShiftIds.has(shift.id)) {
      report(
        "INVALID_INPUT_SHIFT_ID",
        "Input shift IDs must be unique positive integers.",
        { shiftId: shift.id },
      );
    }
    seenShiftIds.add(shift.id);
    if (!Number.isFinite(shift.durationHours) || shift.durationHours <= 0) {
      report(
        "INVALID_SHIFT_DURATION",
        "Shift duration must be finite and positive.",
        { shiftId: shift.id },
      );
    }
    if (
      !shift.date ||
      !shift.startTime ||
      !shift.endTime ||
      shift.startTime === shift.endTime
    ) {
      report(
        "INVALID_SHIFT_WINDOW",
        "Each shift must have a date and distinct start/end times.",
        { shiftId: shift.id },
      );
    }
  }
  const seenRespondentIds = new Set<number>();
  for (const respondent of input.respondents) {
    const context = { respondentId: respondent.id };
    if (!validId(respondent.id) || seenRespondentIds.has(respondent.id)) {
      report(
        "INVALID_INPUT_RESPONDENT_ID",
        "Input respondent IDs must be unique positive integers.",
        context,
      );
    }
    seenRespondentIds.add(respondent.id);
    if (respondent.category !== "AFP" && respondent.category !== "General") {
      report(
        "INVALID_RESPONDENT_CATEGORY",
        "Respondent category must be AFP or General.",
        context,
      );
    }
    if (
      respondent.hasAfpCap &&
      (respondent.category !== "AFP" ||
        !Number.isFinite(respondent.afpHoursCap) ||
        respondent.afpHoursCap < 0)
    ) {
      report(
        "INVALID_AFP_CAP",
        "Only AFP respondents may have a finite, nonnegative AFP cap.",
        context,
      );
    }
    if (
      !Number.isFinite(respondent.penaltyHours) ||
      respondent.penaltyHours < 0
    ) {
      report(
        "INVALID_PENALTY_HOURS",
        "Penalty hours must be finite and nonnegative.",
        context,
      );
    }
    for (const shiftId of respondent.availableShiftIds) {
      if (!shifts.has(shiftId)) {
        report(
          "UNKNOWN_AVAILABILITY_SHIFT",
          "Submitted availability refers to an unknown shift.",
          { ...context, shiftId },
        );
      }
    }
  }

  const manualByShift = new Map<number, number>();
  for (const manual of input.manualAssignments ?? []) {
    if (!shifts.has(manual.shiftId) || !respondents.has(manual.respondentId)) {
      report(
        "UNKNOWN_MANUAL_LOCK",
        "A manual lock refers to an unknown shift or respondent.",
        manual,
      );
    }
    if (manualByShift.has(manual.shiftId)) {
      report(
        "DUPLICATE_MANUAL_LOCK",
        "Each shift may have only one manual lock.",
        manual,
      );
    }
    manualByShift.set(manual.shiftId, manual.respondentId);
  }
  for (const respondent of input.respondents) {
    const lockedShifts = (input.manualAssignments ?? [])
      .filter(
        (manual) =>
          manual.respondentId === respondent.id && shifts.has(manual.shiftId),
      )
      .map((manual) => shifts.get(manual.shiftId)!);
    for (const shift of lockedShifts) {
      if (!respondent.availableShiftIds.has(shift.id)) {
        report(
          "MANUAL_LOCK_OUTSIDE_AVAILABILITY",
          "Manual input locks must be within submitted availability.",
          { respondentId: respondent.id, shiftId: shift.id },
        );
      }
    }
    const manualHours = lockedShifts.reduce(
      (sum, shift) => sum + shift.durationHours,
      0,
    );
    if (
      respondent.hasAfpCap &&
      !input.allowAfpOverCapForAvailableShifts &&
      manualHours > respondent.afpHoursCap + 1e-6
    ) {
      report(
        "MANUAL_LOCKS_EXCEED_AFP_CAP",
        "Manual input locks exceed the normal AFP cap.",
        { respondentId: respondent.id },
      );
    }
    const dates = new Set(lockedShifts.map((shift) => shift.date));
    for (const date of dates) {
      const onDate = lockedShifts.filter((shift) => shift.date === date);
      if (
        onDate.length > 2 ||
        (onDate.length === 2 &&
          onDate[0].endTime !== onDate[1].startTime &&
          onDate[1].endTime !== onDate[0].startTime)
      ) {
        report(
          "MANUAL_LOCKS_VIOLATE_SAME_DAY_RULE",
          `Manual input locks violate the same-day rule on ${date}.`,
          { respondentId: respondent.id },
        );
      }
    }
  }
  return issues;
}

export function assertValidAllocationInput(input: PureAllocationInput): void {
  const issues = validateAllocationInput(input);
  if (issues.length > 0) throw new AllocationValidationError(issues);
}

/**
 * Independent verification of the schedule's hard rules, not of optimizer quality.
 * No allocation/solver helpers are called: their bugs must not certify their own output.
 * Each input shift must occur once, either as an assignment or as an explicit blank.
 * Placeholder hours are excluded only from the normal AFP cap, never from day limits.
 */
export function validateAllocationResult(
  input: PureAllocationInput,
  output: PureAllocationOutput,
): AllocationValidationIssue[] {
  const issues = validateAllocationInput(input);
  const report = (
    code: string,
    message: string,
    context: { respondentId?: number; shiftId?: number } = {},
  ) => issues.push({ code, message, ...context });
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const respondents = new Map(
    input.respondents.map((respondent) => [respondent.id, respondent]),
  );
  const manualByShift = new Map(
    (input.manualAssignments ?? []).map((manual) => [
      manual.shiftId,
      manual.respondentId,
    ]),
  );

  const assignmentByShift = new Map<number, AllocationAssignment>();
  const byRespondent = new Map<number, AllocationAssignment[]>();
  const normalHoursByRespondent = new Map<number, number>();
  for (const assignment of output.assignments) {
    const context = {
      respondentId: assignment.respondentId,
      shiftId: assignment.shiftId,
    };
    if (assignmentByShift.has(assignment.shiftId)) {
      report(
        "DUPLICATE_SHIFT_ASSIGNMENT",
        "A shift is assigned more than once.",
        context,
      );
    }
    assignmentByShift.set(assignment.shiftId, assignment);
    const shift = shifts.get(assignment.shiftId);
    const respondent = respondents.get(assignment.respondentId);
    if (!shift)
      report(
        "UNKNOWN_ASSIGNMENT_SHIFT",
        "An assignment refers to an unknown shift.",
        context,
      );
    if (!respondent)
      report(
        "UNKNOWN_ASSIGNMENT_RESPONDENT",
        "An assignment refers to a respondent outside the allocation.",
        context,
      );
    if (
      !normalSources.has(assignment.source) &&
      !placeholderSources.has(assignment.source)
    ) {
      report(
        "INVALID_ASSIGNMENT_SOURCE",
        "Assigned shifts must have a recognized, nonblank source.",
        context,
      );
    }
    if (
      assignment.source === "manual" &&
      manualByShift.get(assignment.shiftId) !== assignment.respondentId
    ) {
      report(
        "UNAUTHORIZED_MANUAL_SOURCE",
        "A manual assignment must match an explicit input lock.",
        context,
      );
    }
    if (!shift || !respondent) continue;
    byRespondent.set(respondent.id, [
      ...(byRespondent.get(respondent.id) ?? []),
      assignment,
    ]);

    if (placeholderSources.has(assignment.source)) {
      if (
        !input.allowNoAvailabilityAfpPlaceholders ||
        respondent.category !== "AFP" ||
        !respondent.allowNoAvailabilityFallback
      ) {
        report(
          "UNAUTHORIZED_AFP_PLACEHOLDER",
          "Placeholders require global permission and an explicitly selected AFP respondent.",
          context,
        );
      }
      if (
        input.respondents.some((entry) => entry.availableShiftIds.has(shift.id))
      ) {
        report(
          "PLACEHOLDER_HAS_AVAILABILITY",
          "A placeholder is legal only if no included respondent submitted availability for the shift.",
          context,
        );
      }
    } else {
      if (!respondent.availableShiftIds.has(shift.id)) {
        report(
          "OUTSIDE_SUBMITTED_AVAILABILITY",
          "A normal or manual assignment is outside the respondent's submitted availability.",
          context,
        );
      }
      normalHoursByRespondent.set(
        respondent.id,
        (normalHoursByRespondent.get(respondent.id) ?? 0) + shift.durationHours,
      );
    }
    if (
      assignment.source === "engine_afp_cap_overflow_available" &&
      (!input.allowAfpOverCapForAvailableShifts ||
        respondent.category !== "AFP" ||
        !respondent.hasAfpCap)
    ) {
      report(
        "UNAUTHORIZED_AFP_CAP_OVERFLOW",
        "AFP overflow provenance requires a capped AFP respondent and explicit overflow permission.",
        context,
      );
    }
  }

  for (const [shiftId, respondentId] of manualByShift) {
    const assignment = assignmentByShift.get(shiftId);
    if (
      assignment?.respondentId !== respondentId ||
      assignment.source !== "manual"
    ) {
      report(
        "MANUAL_LOCK_NOT_PRESERVED",
        "The output must preserve every manual lock with its manual provenance.",
        { shiftId, respondentId },
      );
    }
  }
  const unallocated = new Set<number>();
  for (const shiftId of output.unallocatedShiftIds) {
    if (!shifts.has(shiftId))
      report(
        "UNKNOWN_UNALLOCATED_SHIFT",
        "An unallocated ID is not an input shift.",
        { shiftId },
      );
    if (unallocated.has(shiftId))
      report(
        "DUPLICATE_UNALLOCATED_SHIFT",
        "An unallocated shift is listed more than once.",
        { shiftId },
      );
    if (assignmentByShift.has(shiftId))
      report(
        "ASSIGNED_AND_UNALLOCATED",
        "A shift cannot be both assigned and unallocated.",
        { shiftId },
      );
    unallocated.add(shiftId);
  }
  for (const shiftId of shifts.keys()) {
    if (!assignmentByShift.has(shiftId) && !unallocated.has(shiftId)) {
      report(
        "UNACCOUNTED_SHIFT",
        "An input shift is neither assigned nor explicitly unallocated.",
        { shiftId },
      );
    }
  }

  for (const respondent of input.respondents) {
    const assignments = byRespondent.get(respondent.id) ?? [];
    const context = { respondentId: respondent.id };
    if (
      respondent.hasAfpCap &&
      !input.allowAfpOverCapForAvailableShifts &&
      (normalHoursByRespondent.get(respondent.id) ?? 0) >
        respondent.afpHoursCap + 1e-6
    ) {
      report(
        "AFP_NORMAL_CAP_EXCEEDED",
        "Normal and manual hours exceed the AFP cap; placeholder hours are accounted separately.",
        context,
      );
    }
    const byDate = new Map<string, typeof input.shifts>();
    for (const assignment of assignments) {
      const shift = shifts.get(assignment.shiftId)!;
      byDate.set(shift.date, [...(byDate.get(shift.date) ?? []), shift]);
    }
    for (const [date, dayShifts] of byDate) {
      if (dayShifts.length > 2) {
        report(
          "MORE_THAN_TWO_SHIFTS_IN_DAY",
          `Respondent has more than two shifts on ${date}.`,
          context,
        );
      }
      for (let a = 0; a < dayShifts.length; a++) {
        for (let b = a + 1; b < dayShifts.length; b++) {
          if (
            dayShifts[a].endTime !== dayShifts[b].startTime &&
            dayShifts[b].endTime !== dayShifts[a].startTime
          ) {
            report(
              "NON_ADJACENT_SAME_DAY_SHIFTS",
              `Respondent has nonadjacent or overlapping shifts on ${date}.`,
              context,
            );
          }
        }
      }
    }
  }

  const planIds = new Set<number>();
  for (const plan of output.plans) {
    const context = { respondentId: plan.respondentId };
    const respondent = respondents.get(plan.respondentId);
    if (!respondent)
      report(
        "UNKNOWN_PLAN_RESPONDENT",
        "A plan belongs to a respondent outside the allocation.",
        context,
      );
    if (planIds.has(plan.respondentId))
      report(
        "DUPLICATE_RESPONDENT_PLAN",
        "Each respondent must have exactly one plan.",
        context,
      );
    planIds.add(plan.respondentId);
    if (respondent && plan.category !== respondent.category) {
      report(
        "PLAN_CATEGORY_MISMATCH",
        "Plan category does not match the respondent.",
        context,
      );
    }
    const assignments = byRespondent.get(plan.respondentId) ?? [];
    const expectedIds = new Set(
      assignments.map((assignment) => assignment.shiftId),
    );
    if (
      new Set(plan.shiftIds).size !== plan.shiftIds.length ||
      plan.shiftIds.length !== assignments.length ||
      plan.shiftIds.some((shiftId) => !expectedIds.has(shiftId))
    ) {
      report(
        "PLAN_ASSIGNMENT_MISMATCH",
        "Plan shift IDs must match the respondent's assignments exactly once each.",
        context,
      );
    }
    const expectedHours = assignments.reduce(
      (sum, assignment) => sum + shifts.get(assignment.shiftId)!.durationHours,
      0,
    );
    if (!near(plan.totalHours, expectedHours)) {
      report(
        "PLAN_HOURS_MISMATCH",
        "Plan hours do not equal the durations of all assigned shifts, including placeholders.",
        context,
      );
    }
    if (
      plan.isManuallyAdjusted !==
      assignments.some((assignment) => assignment.source === "manual")
    ) {
      report(
        "PLAN_MANUAL_FLAG_MISMATCH",
        "Plan manual flag does not match assignment provenance.",
        context,
      );
    }
  }
  for (const respondentId of respondents.keys()) {
    if (!planIds.has(respondentId))
      report(
        "MISSING_RESPONDENT_PLAN",
        "Every included respondent requires a plan, including those with zero hours.",
        { respondentId },
      );
  }
  const hours = input.respondents.map((respondent) =>
    (byRespondent.get(respondent.id) ?? []).reduce(
      (sum, assignment) => sum + shifts.get(assignment.shiftId)!.durationHours,
      0,
    ),
  );
  const mean = hours.length
    ? hours.reduce((sum, value) => sum + value, 0) / hours.length
    : 0;
  const deviation = hours.length
    ? Math.sqrt(
        hours.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          hours.length,
      )
    : 0;
  if (!near(output.averageHours, mean))
    report(
      "AVERAGE_HOURS_MISMATCH",
      "Overall average hours must match assigned hours across all included respondents.",
    );
  if (!near(output.stdDev, deviation))
    report(
      "STANDARD_DEVIATION_MISMATCH",
      "Overall standard deviation must match assigned hours across all included respondents.",
    );
  return issues;
}

export function assertValidAllocationResult(
  input: PureAllocationInput,
  output: PureAllocationOutput,
): void {
  const issues = validateAllocationResult(input, output);
  if (issues.length > 0) throw new AllocationValidationError(issues);
}
