import test from "node:test";
import assert from "node:assert/strict";
import {
  runPureAllocation,
  type AllocationRespondentInput,
  type AllocationShiftInput,
} from "./allocationEngine.js";

const weekday = [
  shift(1, "09:00", "11:00", 2),
  shift(2, "11:00", "14:00", 3),
  shift(3, "14:00", "17:00", 3),
  shift(4, "17:00", "20:00", 3),
];

function shift(id: number, startTime: string, endTime: string, durationHours: number): AllocationShiftInput {
  return {
    id,
    date: "2026-05-04",
    dayType: "weekday",
    startTime,
    endTime,
    durationHours,
    label: `${startTime}-${endTime}`,
  };
}

function respondent(
  id: number,
  name: string,
  availableShiftIds: number[],
  overrides: Partial<AllocationRespondentInput> = {},
): AllocationRespondentInput {
  return {
    id,
    name,
    category: overrides.category ?? "General",
    availableShiftIds: new Set(availableShiftIds),
    hasPenalty: overrides.hasPenalty ?? false,
    penaltyHours: overrides.penaltyHours ?? 0,
    afpHoursCap: overrides.afpHoursCap ?? 10,
    allowNoAvailabilityFallback: overrides.allowNoAvailabilityFallback ?? false,
  };
}

function assignmentFor(output: ReturnType<typeof runPureAllocation>, shiftId: number) {
  return output.assignments.find((assignment) => assignment.shiftId === shiftId);
}

test("blank_shift_despite_availability_regression assigns a shift with a legal available candidate", () => {
  const output = runPureAllocation({
    shifts: [weekday[0]],
    respondents: [respondent(1, "Alice", [1])],
  });

  assert.equal(output.unallocatedShiftIds.length, 0);
  assert.equal(assignmentFor(output, 1)?.respondentId, 1);
  assert.equal(assignmentFor(output, 1)?.source, "engine_normal");
});

test("strike_ignored_regression keeps penalized respondents eligible when coverage needs them", () => {
  const output = runPureAllocation({
    shifts: [weekday[0]],
    respondents: [respondent(1, "Penalized", [1], { hasPenalty: true, penaltyHours: 100 })],
  });

  assert.equal(output.unallocatedShiftIds.length, 0);
  assert.equal(assignmentFor(output, 1)?.respondentId, 1);
});

test("three_shifts_same_day_regression never assigns three shifts in one day", () => {
  const output = runPureAllocation({
    shifts: weekday,
    respondents: [respondent(1, "Alice", [1, 2, 3, 4])],
  });

  const assigned = output.assignments.filter((assignment) => assignment.respondentId === 1);
  assert.equal(assigned.length, 2);
  assert.deepEqual(
    assigned.map((assignment) => assignment.shiftId),
    [2, 3],
  );
});

test("morning_evening_same_day_regression forbids non-adjacent same-day doubles", () => {
  const output = runPureAllocation({
    shifts: [weekday[0], weekday[3]],
    respondents: [respondent(1, "Alice", [1, 4])],
  });

  assert.equal(output.assignments.length, 1);
  assert.equal(output.unallocatedShiftIds.length, 1);
});

test("adjacent double can be used as a back-to-back emergency", () => {
  const output = runPureAllocation({
    shifts: [weekday[0], weekday[1]],
    respondents: [respondent(1, "Alice", [1, 2])],
  });

  assert.equal(output.unallocatedShiftIds.length, 0);
  assert.equal(output.assignments.some((assignment) => assignment.source === "engine_back_to_back_emergency"), true);
});

test("non-adjacent double remains blank when no legal repair exists", () => {
  const output = runPureAllocation({
    shifts: [weekday[0], weekday[2]],
    respondents: [respondent(1, "Alice", [1, 3])],
  });

  assert.equal(output.assignments.length, 1);
  assert.equal(output.unallocatedShiftIds.length, 1);
});

test("no unavailable assignment leaves a no-availability shift blank", () => {
  const output = runPureAllocation({
    shifts: [weekday[0]],
    respondents: [respondent(1, "Alice", [])],
  });

  assert.deepEqual(output.unallocatedShiftIds, [1]);
  assert.equal(assignmentFor(output, 1), undefined);
});

test("no_afp_no_availability_fallback_regression leaves no-availability shifts blank", () => {
  const output = runPureAllocation({
    shifts: [weekday[0]],
    respondents: [
      respondent(1, "Fallback AFP", [], {
        category: "AFP",
        afpHoursCap: 0,
        allowNoAvailabilityFallback: true,
      }),
    ],
  });

  assert.deepEqual(output.unallocatedShiftIds, [1]);
  assert.equal(assignmentFor(output, 1), undefined);
});

test("available AFP cap overflow is explicit and opt-in", () => {
  const baseInput = {
    shifts: [weekday[0]],
    respondents: [
      respondent(1, "Capped AFP", [1], {
        category: "AFP",
        afpHoursCap: 0,
      }),
    ],
  };

  const capped = runPureAllocation(baseInput);
  const overflow = runPureAllocation({ ...baseInput, allowAfpOverCapForAvailableShifts: true });

  assert.deepEqual(capped.unallocatedShiftIds, [1]);
  assert.equal(assignmentFor(overflow, 1)?.source, "engine_afp_cap_overflow_available");
});

test("AFP cap respected for normal and back-to-back emergency assignments", () => {
  const output = runPureAllocation({
    shifts: weekday.slice(0, 3),
    respondents: [
      respondent(1, "Capped AFP", [1, 2, 3], {
        category: "AFP",
        afpHoursCap: 5,
      }),
    ],
  });

  assert.deepEqual(
    output.assignments.map((assignment) => assignment.shiftId),
    [1, 2],
  );
  assert.equal(output.unallocatedShiftIds.includes(3), true);
});

test("preserve manual locks keeps manual assignments and allocates around them", () => {
  const output = runPureAllocation({
    shifts: [weekday[0], weekday[1]],
    respondents: [respondent(1, "Manual", []), respondent(2, "Available", [2])],
    manualAssignments: [{ respondentId: 1, shiftId: 1 }],
  });

  assert.equal(assignmentFor(output, 1)?.source, "manual");
  assert.equal(assignmentFor(output, 2)?.respondentId, 2);
  assert.equal(output.unallocatedShiftIds.length, 0);
});

test("fairness_high_sd_regression keeps balanced feasible non-penalized allocation under target threshold", () => {
  const monday = shift(11, "09:00", "11:00", 2);
  const tuesday = { ...shift(12, "09:00", "11:00", 2), date: "2026-05-05" };
  const wednesday = { ...shift(13, "09:00", "11:00", 2), date: "2026-05-06" };
  const thursday = { ...shift(14, "09:00", "11:00", 2), date: "2026-05-07" };

  const output = runPureAllocation({
    shifts: [monday, tuesday, wednesday, thursday],
    respondents: [
      respondent(1, "Alice", [11, 12, 13, 14]),
      respondent(2, "Bob", [11, 12, 13, 14]),
      respondent(3, "Caleb", [11, 12, 13, 14]),
      respondent(4, "Dana", [11, 12, 13, 14]),
    ],
  });

  assert.equal(output.assignments.length, 4);
  assert.equal(output.fairnessDiagnostics.nonPenalizedGeneralStdDevHours <= 2, true);
});

test("coverage preserved during fairness repair", () => {
  const output = runPureAllocation({
    shifts: [
      shift(21, "09:00", "11:00", 2),
      { ...shift(22, "09:00", "11:00", 2), date: "2026-05-05" },
      { ...shift(23, "09:00", "11:00", 2), date: "2026-05-06" },
    ],
    respondents: [
      respondent(1, "Alice", [21, 22, 23]),
      respondent(2, "Bob", [21, 22, 23]),
    ],
  });

  assert.equal(output.fairnessDiagnostics.assignedShiftCountBeforeRepair, output.assignments.length);
  assert.equal(output.fairnessDiagnostics.assignedShiftCountAfterRepair, output.assignments.length);
});
