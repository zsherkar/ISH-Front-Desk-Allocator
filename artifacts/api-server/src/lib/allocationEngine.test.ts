import test from "node:test";
import assert from "node:assert/strict";
import { runPureAllocation, type AllocationRespondentInput, type AllocationShiftInput } from "./allocationEngine.js";

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
  const category = overrides.category ?? "General";
  return {
    id,
    name,
    category,
    availableShiftIds: new Set(availableShiftIds),
    hasPenalty: overrides.hasPenalty ?? false,
    penaltyHours: overrides.penaltyHours ?? 0,
    hasAfpCap: overrides.hasAfpCap ?? category === "AFP",
    afpHoursCap: overrides.afpHoursCap ?? 10,
    allowNoAvailabilityFallback: overrides.allowNoAvailabilityFallback ?? false,
  };
}

function assignmentFor(output: Awaited<ReturnType<typeof runPureAllocation>>, shiftId: number) {
  return output.assignments.find((assignment) => assignment.shiftId === shiftId);
}

test("blank_shift_despite_availability_regression assigns a shift with a legal available candidate", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0]],
    respondents: [respondent(1, "Alice", [1])],
  });

  assert.equal(output.unallocatedShiftIds.length, 0);
  assert.equal(assignmentFor(output, 1)?.respondentId, 1);
  assert.equal(assignmentFor(output, 1)?.source, "engine_normal");
});

test("strike_ignored_regression keeps penalized respondents eligible when coverage needs them", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0]],
    respondents: [respondent(1, "Penalized", [1], { hasPenalty: true, penaltyHours: 100 })],
  });

  assert.equal(output.unallocatedShiftIds.length, 0);
  assert.equal(assignmentFor(output, 1)?.respondentId, 1);
});

test("three_shifts_same_day_regression never assigns three shifts in one day", async () => {
  const output = await runPureAllocation({
    shifts: weekday,
    respondents: [respondent(1, "Alice", [1, 2, 3, 4])],
  });

  const assigned = output.assignments.filter((assignment) => assignment.respondentId === 1);
  assert.equal(assigned.length, 2);
  assert.equal(assigned[1].shiftId - assigned[0].shiftId, 1);
});

test("morning_evening_same_day_regression forbids non-adjacent same-day doubles", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0], weekday[3]],
    respondents: [respondent(1, "Alice", [1, 4])],
  });

  assert.equal(output.assignments.length, 1);
  assert.equal(output.unallocatedShiftIds.length, 1);
});

test("adjacent double can be used as a back-to-back emergency", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0], weekday[1]],
    respondents: [respondent(1, "Alice", [1, 2])],
  });

  assert.equal(output.unallocatedShiftIds.length, 0);
  assert.equal(
    output.assignments.some((assignment) => assignment.source === "engine_back_to_back_emergency"),
    true,
  );
});

test("non-adjacent double remains blank when no legal repair exists", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0], weekday[2]],
    respondents: [respondent(1, "Alice", [1, 3])],
  });

  assert.equal(output.assignments.length, 1);
  assert.equal(output.unallocatedShiftIds.length, 1);
});

test("no unavailable assignment leaves a no-availability shift blank", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0]],
    respondents: [respondent(1, "Alice", [])],
  });

  assert.deepEqual(output.unallocatedShiftIds, [1]);
  assert.equal(assignmentFor(output, 1), undefined);
});

test("no_availability_afp_placeholder_off_by_default leaves no-availability shifts blank", async () => {
  const output = await runPureAllocation({
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

test("no_availability_afp_placeholder assigns zero-availability shift only when enabled", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0]],
    allowNoAvailabilityAfpPlaceholders: true,
    respondents: [
      respondent(1, "Fallback AFP", [], {
        category: "AFP",
        afpHoursCap: 0,
        allowNoAvailabilityFallback: true,
      }),
    ],
  });

  assert.deepEqual(output.unallocatedShiftIds, []);
  assert.equal(assignmentFor(output, 1)?.respondentId, 1);
  assert.equal(assignmentFor(output, 1)?.source, "admin_no_availability_afp_placeholder");
});

test("no_availability_afp_placeholder cannot be assigned to non-AFP", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0]],
    allowNoAvailabilityAfpPlaceholders: true,
    respondents: [
      respondent(1, "General Fallback", [], {
        category: "General",
        allowNoAvailabilityFallback: true,
      }),
    ],
  });

  assert.deepEqual(output.unallocatedShiftIds, [1]);
  assert.equal(assignmentFor(output, 1), undefined);
});

test("no_availability_afp_placeholder cannot be used when someone selected the shift", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0]],
    allowNoAvailabilityAfpPlaceholders: true,
    respondents: [
      respondent(1, "Available General", [1]),
      respondent(2, "Fallback AFP", [], {
        category: "AFP",
        allowNoAvailabilityFallback: true,
      }),
    ],
  });

  assert.equal(assignmentFor(output, 1)?.respondentId, 1);
  assert.equal(assignmentFor(output, 1)?.source, "engine_normal");
});

test("no_availability_afp_placeholder may exceed AFP cap without normal cap violation", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0]],
    allowNoAvailabilityAfpPlaceholders: true,
    respondents: [
      respondent(1, "Fallback AFP", [], {
        category: "AFP",
        afpHoursCap: 0,
        allowNoAvailabilityFallback: true,
      }),
    ],
  });

  assert.equal(assignmentFor(output, 1)?.source, "admin_no_availability_afp_placeholder");
  assert.deepEqual(assignmentFor(output, 1)?.explanationCodes, ["NO_AVAILABILITY"]);
});

test("no_availability_afp_placeholder respects same-day rules by default", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0], weekday[2]],
    allowNoAvailabilityAfpPlaceholders: true,
    respondents: [
      respondent(1, "Fallback AFP", [], {
        category: "AFP",
        afpHoursCap: 0,
        allowNoAvailabilityFallback: true,
      }),
    ],
  });

  assert.equal(output.assignments.length, 1);
  assert.equal(output.unallocatedShiftIds.length, 1);
});

test("available AFP cap overflow is explicit and opt-in", async () => {
  const baseInput = {
    shifts: [weekday[0]],
    respondents: [
      respondent(1, "Capped AFP", [1], {
        category: "AFP",
        afpHoursCap: 0,
      }),
    ],
  };

  const capped = await runPureAllocation(baseInput);
  const overflow = await runPureAllocation({
    ...baseInput,
    allowAfpOverCapForAvailableShifts: true,
  });

  assert.deepEqual(capped.unallocatedShiftIds, [1]);
  assert.equal(assignmentFor(overflow, 1)?.source, "engine_afp_cap_overflow_available");
});

test("AFP without an enabled cap participates in normal equal allocation", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0]],
    respondents: [
      respondent(1, "Uncapped AFP", [1], {
        category: "AFP",
        hasAfpCap: false,
        afpHoursCap: 0,
      }),
    ],
  });

  assert.equal(assignmentFor(output, 1)?.respondentId, 1);
  assert.equal(assignmentFor(output, 1)?.source, "engine_normal");
  assert.deepEqual(output.unallocatedShiftIds, []);
});

test("AFP cap respected for normal and back-to-back emergency assignments", async () => {
  const output = await runPureAllocation({
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

test("preserve manual locks keeps manual assignments and allocates around them", async () => {
  const output = await runPureAllocation({
    shifts: [weekday[0], weekday[1]],
    respondents: [respondent(1, "Manual", []), respondent(2, "Available", [2])],
    manualAssignments: [{ respondentId: 1, shiftId: 1 }],
  });

  assert.equal(assignmentFor(output, 1)?.source, "manual");
  assert.equal(assignmentFor(output, 2)?.respondentId, 2);
  assert.equal(output.unallocatedShiftIds.length, 0);
});

test("fairness_high_sd_regression keeps balanced feasible non-penalized allocation under target threshold", async () => {
  const monday = shift(11, "09:00", "11:00", 2);
  const tuesday = { ...shift(12, "09:00", "11:00", 2), date: "2026-05-05" };
  const wednesday = { ...shift(13, "09:00", "11:00", 2), date: "2026-05-06" };
  const thursday = { ...shift(14, "09:00", "11:00", 2), date: "2026-05-07" };

  const output = await runPureAllocation({
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

test("coverage preserved during fairness repair", async () => {
  const output = await runPureAllocation({
    shifts: [
      shift(21, "09:00", "11:00", 2),
      { ...shift(22, "09:00", "11:00", 2), date: "2026-05-05" },
      { ...shift(23, "09:00", "11:00", 2), date: "2026-05-06" },
    ],
    respondents: [respondent(1, "Alice", [21, 22, 23]), respondent(2, "Bob", [21, 22, 23])],
  });

  assert.equal(output.fairnessDiagnostics.assignedShiftCountBeforeRepair, output.assignments.length);
  assert.equal(output.fairnessDiagnostics.assignedShiftCountAfterRepair, output.assignments.length);
});

test("global optimizer removes avoidable back-to-back days without worsening fairness", async () => {
  const dayOneMorning = shift(31, "09:00", "11:00", 2);
  const dayOneMidday = shift(32, "11:00", "14:00", 3);
  const dayTwoMorning = {
    ...shift(33, "09:00", "11:00", 2),
    date: "2026-05-05",
  };
  const dayTwoMidday = {
    ...shift(34, "11:00", "14:00", 3),
    date: "2026-05-05",
  };

  const output = await runPureAllocation({
    shifts: [dayOneMorning, dayOneMidday, dayTwoMorning, dayTwoMidday],
    respondents: [respondent(1, "Alice", [31, 32, 33, 34]), respondent(2, "Bob", [31, 32, 33, 34])],
  });

  assert.equal(output.fairnessDiagnostics.optimizationMethod, "global_milp");
  assert.equal(output.fairnessDiagnostics.backToBackPairDays, 0);
  assert.deepEqual(
    output.plans.map((plan) => plan.totalHours).sort((a, b) => a - b),
    [5, 5],
  );
});

test("global optimizer includes forced AFP placeholder hours in the fair monthly balance", async () => {
  const unavailable = shift(41, "09:00", "11:00", 2);
  const availableOne = {
    ...shift(42, "09:00", "11:00", 2),
    date: "2026-05-05",
  };
  const availableTwo = {
    ...shift(43, "09:00", "11:00", 2),
    date: "2026-05-06",
  };
  const availableThree = {
    ...shift(44, "09:00", "11:00", 2),
    date: "2026-05-07",
  };

  const output = await runPureAllocation({
    shifts: [unavailable, availableOne, availableTwo, availableThree],
    allowNoAvailabilityAfpPlaceholders: true,
    respondents: [
      respondent(1, "Alice", [42, 43, 44], {
        category: "AFP",
        hasAfpCap: false,
        allowNoAvailabilityFallback: true,
      }),
      respondent(2, "Bob", [42, 43, 44], {
        category: "AFP",
        hasAfpCap: false,
      }),
    ],
  });

  assert.equal(assignmentFor(output, 41)?.respondentId, 1);
  assert.equal(assignmentFor(output, 41)?.source, "admin_no_availability_afp_placeholder");
  assert.deepEqual(
    output.plans.map((plan) => plan.totalHours).sort((a, b) => a - b),
    [4, 4],
  );
  assert.equal(output.fairnessDiagnostics.nonPenalizedGeneralStdDevHours, 0);
});
