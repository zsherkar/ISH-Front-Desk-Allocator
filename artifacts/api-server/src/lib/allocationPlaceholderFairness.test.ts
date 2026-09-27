import test from "node:test";
import assert from "node:assert/strict";
import {
  runPureAllocation,
  type AllocationRespondentInput,
  type AllocationShiftInput,
  type PureAllocationOutput,
} from "./allocationEngine.js";

function shifts(count: number): AllocationShiftInput[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    date: `2026-10-${String(index + 1).padStart(2, "0")}`,
    dayType: "weekday",
    startTime: "09:00",
    endTime: "12:00",
    durationHours: 3,
    label: "09:00-12:00",
  }));
}

function afp(
  id: number,
  available: number[],
  cap: number,
  overrides: Partial<AllocationRespondentInput> = {},
): AllocationRespondentInput {
  return {
    id,
    name: `Person ${id}`,
    category: "AFP",
    availableShiftIds: new Set(available),
    hasPenalty: false,
    penaltyHours: 0,
    hasAfpCap: true,
    afpHoursCap: cap,
    allowNoAvailabilityFallback: true,
    ...overrides,
  };
}

function separateHours(
  output: PureAllocationOutput,
  inputShifts: AllocationShiftInput[],
  id: number,
) {
  const own = output.assignments.filter(
    (assignment) => assignment.respondentId === id,
  );
  const hours = (placeholder: boolean) =>
    own
      .filter(
        (assignment) =>
          (assignment.source === "admin_no_availability_afp_placeholder") ===
          placeholder,
      )
      .reduce(
        (sum, assignment) =>
          sum +
          inputShifts.find((shift) => shift.id === assignment.shiftId)!
            .durationHours,
        0,
      );
  return { normal: hours(false), placeholder: hours(true) };
}

test("selected capped AFP share placeholder hours instead of arbitrary 15/3 total workloads", async () => {
  const inputShifts = shifts(6);
  const output = await runPureAllocation({
    shifts: inputShifts,
    respondents: [afp(1, [1, 2], 3), afp(2, [1, 2], 3)],
    allowNoAvailabilityAfpPlaceholders: true,
  });
  assert.deepEqual(output.unallocatedShiftIds, []);
  assert.deepEqual(
    output.plans.map((plan) => plan.totalHours),
    [9, 9],
  );
  for (const id of [1, 2]) {
    assert.deepEqual(separateHours(output, inputShifts, id), {
      normal: 3,
      placeholder: 6,
    });
  }
  assert.equal(output.fairnessDiagnostics.optimizerStatus, "optimal");
  assert.equal(output.fairnessDiagnostics.backToBackPairDays, 0);
});

test("placeholder shares remain separate when AFP normal targets differ", async () => {
  const inputShifts = shifts(7);
  const output = await runPureAllocation({
    shifts: inputShifts,
    respondents: [afp(1, [1], 3), afp(2, [2, 3], 6)],
    allowNoAvailabilityAfpPlaceholders: true,
  });
  assert.deepEqual(output.unallocatedShiftIds, []);
  assert.deepEqual(separateHours(output, inputShifts, 1), {
    normal: 3,
    placeholder: 6,
  });
  assert.deepEqual(separateHours(output, inputShifts, 2), {
    normal: 6,
    placeholder: 6,
  });
  assert.deepEqual(
    output.plans.map((plan) => plan.totalHours),
    [9, 12],
  );
});

test("placeholder fairness includes only explicitly selected AFP respondents", async () => {
  const inputShifts = shifts(6);
  const output = await runPureAllocation({
    shifts: inputShifts,
    respondents: [
      afp(1, [1, 2], 3),
      afp(2, [1, 2], 3),
      afp(3, [], 3, { allowNoAvailabilityFallback: false }),
      afp(4, [], 0, { category: "General", hasAfpCap: false }),
    ],
    allowNoAvailabilityAfpPlaceholders: true,
  });
  assert.deepEqual(output.unallocatedShiftIds, []);
  assert.deepEqual(separateHours(output, inputShifts, 1), {
    normal: 3,
    placeholder: 6,
  });
  assert.deepEqual(separateHours(output, inputShifts, 2), {
    normal: 3,
    placeholder: 6,
  });
  assert.equal(
    output.assignments.some((assignment) => assignment.respondentId > 2),
    false,
  );
});

test("placeholder balancing preserves hard same-day restrictions and full normal targets", async () => {
  const inputShifts = shifts(4);
  inputShifts[2] = {
    ...inputShifts[2],
    date: inputShifts[0].date,
    startTime: "15:00",
    endTime: "18:00",
  };
  inputShifts[3] = {
    ...inputShifts[3],
    date: inputShifts[1].date,
    startTime: "15:00",
    endTime: "18:00",
  };
  const output = await runPureAllocation({
    shifts: inputShifts,
    respondents: [afp(1, [1], 3), afp(2, [2], 3)],
    allowNoAvailabilityAfpPlaceholders: true,
  });
  assert.deepEqual(output.unallocatedShiftIds, []);
  assert.equal(
    output.assignments.find((assignment) => assignment.shiftId === 3)
      ?.respondentId,
    2,
  );
  assert.equal(
    output.assignments.find((assignment) => assignment.shiftId === 4)
      ?.respondentId,
    1,
  );
  assert.deepEqual(separateHours(output, inputShifts, 1), {
    normal: 3,
    placeholder: 3,
  });
  assert.deepEqual(separateHours(output, inputShifts, 2), {
    normal: 3,
    placeholder: 3,
  });
  assert.equal(output.fairnessDiagnostics.backToBackPairDays, 0);
});
