import test from "node:test";
import assert from "node:assert/strict";
import {
  AllocationOptimizationError,
  runPureAllocation,
  type PureAllocationInput,
  type PureAllocationOutput,
} from "./allocationEngine.js";
import { createOverlapRegressionInput } from "./fixtures/allocationOverlap.js";

const placeholderSource = "admin_no_availability_afp_placeholder";

/** Deliberately independent of the implementation's capacity/validation helpers. */
function auditSchedule(
  input: PureAllocationInput,
  output: PureAllocationOutput,
) {
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const respondents = new Map(
    input.respondents.map((person) => [person.id, person]),
  );
  const assigned = new Set<number>();
  const byDay = new Map<string, typeof input.shifts>();
  const normalMinutes = new Map<number, number>();
  const placeholderMinutes = new Map<number, number>();
  for (const assignment of output.assignments) {
    const shift = shifts.get(assignment.shiftId);
    const person = respondents.get(assignment.respondentId);
    assert.ok(shift, "every assigned shift exists");
    assert.ok(person, "every assignee exists");
    assert.ok(!assigned.has(shift.id), "a shift has exactly one assignee");
    assigned.add(shift.id);
    const isPlaceholder = assignment.source === placeholderSource;
    if (isPlaceholder) {
      assert.equal(input.allowNoAvailabilityAfpPlaceholders, true);
      assert.equal(person.category, "AFP");
      assert.equal(person.allowNoAvailabilityFallback, true);
      assert.ok(
        input.respondents.every(
          (entry) => !entry.availableShiftIds.has(shift.id),
        ),
        "placeholders are allowed only when no included response selected the shift",
      );
    } else {
      assert.ok(
        person.availableShiftIds.has(shift.id),
        "ordinary assignment matches submitted availability",
      );
    }
    const totals = isPlaceholder ? placeholderMinutes : normalMinutes;
    totals.set(
      person.id,
      (totals.get(person.id) ?? 0) + Math.round(shift.durationHours * 60),
    );
    const key = `${person.id}:${shift.date}`;
    byDay.set(key, [...(byDay.get(key) ?? []), shift]);
  }
  let adjacentPairDays = 0;
  for (const day of byDay.values()) {
    assert.ok(
      day.length <= 2,
      "no person receives more than two shifts per day",
    );
    if (day.length === 2) {
      day.sort((a, b) => a.startTime.localeCompare(b.startTime));
      assert.equal(
        day[0].endTime,
        day[1].startTime,
        "two same-day shifts must be adjacent",
      );
      adjacentPairDays += 1;
    }
  }
  for (const person of input.respondents) {
    if (person.hasAfpCap && !input.allowAfpOverCapForAvailableShifts) {
      assert.ok(
        (normalMinutes.get(person.id) ?? 0) <=
          Math.round(person.afpHoursCap * 60),
        "ordinary AFP allocation stays within the enabled cap",
      );
    }
    const plan = output.plans.find((entry) => entry.respondentId === person.id);
    assert.ok(plan);
    const actualIds = output.assignments
      .filter((entry) => entry.respondentId === person.id)
      .map((entry) => entry.shiftId)
      .sort((a, b) => a - b);
    assert.deepEqual(
      [...plan.shiftIds].sort((a, b) => a - b),
      actualIds,
    );
    assert.equal(
      Math.round(plan.totalHours * 60),
      (normalMinutes.get(person.id) ?? 0) +
        (placeholderMinutes.get(person.id) ?? 0),
    );
  }
  assert.deepEqual(
    [...output.unallocatedShiftIds].sort((a, b) => a - b),
    input.shifts
      .filter((shift) => !assigned.has(shift.id))
      .map((shift) => shift.id)
      .sort((a, b) => a - b),
  );
  assert.equal(output.fairnessDiagnostics.backToBackPairDays, adjacentPairDays);
  return { normalMinutes, placeholderMinutes, adjacentPairDays };
}

function assertOverlapPolicy(
  input: PureAllocationInput,
  output: PureAllocationOutput,
) {
  const audited = auditSchedule(input, output);
  assert.equal(input.shifts.length, 115);
  assert.equal(output.assignments.length, 114);
  assert.equal(output.unallocatedShiftIds.length, 1);
  assert.equal(output.fairnessDiagnostics.optimizationMethod, "global_milp");
  assert.equal(output.fairnessDiagnostics.optimalCoverageProven, true);
  assert.match(
    output.fairnessDiagnostics.optimizerStatus ?? "",
    /^(optimal|bounded:)/,
  );
  assert.deepEqual(
    [9, 10, 11, 12].map((id) => audited.normalMinutes.get(id)),
    [600, 540, 540, 540],
  );
  assert.equal(
    [...audited.placeholderMinutes.values()].reduce(
      (sum, minutes) => sum + minutes,
      0,
    ),
    360,
  );
  assert.deepEqual(
    [...audited.placeholderMinutes.keys()].sort((a, b) => a - b),
    [10, 12],
  );
  const generalHours = input.respondents
    .filter((person) => person.category === "General")
    .map((person) => (audited.normalMinutes.get(person.id) ?? 0) / 60);
  assert.ok(
    Math.max(...generalHours) - Math.min(...generalHours) <= 11,
    `General hours remain in the proven attainable range: ${generalHours}`,
  );
  assert.ok(
    audited.adjacentPairDays <= 12,
    `expected at most 12 adjacent pairs, got ${audited.adjacentPairDays}`,
  );
}

test(
  "overlapping monthly responses preserve AFP targets, narrow fairness, and valid rare doubles on regeneration",
  {
    timeout: 300_000,
  },
  async () => {
    const input = createOverlapRegressionInput();
    const before = structuredClone(input);
    const first = await runPureAllocation(input);
    assertOverlapPolicy(input, first);
    assert.deepEqual(
      input,
      before,
      "allocation does not mutate responses or policy inputs",
    );
    const second = await runPureAllocation(input);
    assertOverlapPolicy(input, second);
    assert.deepEqual(input, before, "regeneration does not mutate inputs");
    // A bounded solver can choose a different tied schedule at its time limit.
    // Require the same policy guarantees, not accidental assignment tie-breaking.
  },
);

function createAfpCompetitionInput(): PureAllocationInput {
  const durations = [3, 3, 2, 2, 3, 3, 3, 3, 3];
  return {
    shifts: durations.map((hours, index) => ({
      id: index + 1,
      date: `2037-11-${String(index + 1).padStart(2, "0")}`,
      startTime: "09:00",
      endTime: hours === 2 ? "11:00" : "12:00",
      durationHours: hours,
      dayType: "weekday",
      label: `Shift ${index + 1}`,
    })),
    respondents: [
      {
        id: 1,
        name: "Capped participant",
        category: "AFP",
        availableShiftIds: new Set([1, 2, 3, 4]),
        hasPenalty: false,
        penaltyHours: 0,
        hasAfpCap: true,
        afpHoursCap: 10,
        allowNoAvailabilityFallback: false,
      },
      {
        id: 2,
        name: "General participant",
        category: "General",
        availableShiftIds: new Set([1, 2, 3, 4, 5, 6, 7, 8]),
        hasPenalty: false,
        penaltyHours: 0,
        hasAfpCap: false,
        afpHoursCap: 10,
        allowNoAvailabilityFallback: false,
      },
    ],
    allowNoAvailabilityAfpPlaceholders: true,
    allowAfpOverCapForAvailableShifts: false,
    allowExtremeNoAvailabilityAfpStacking: false,
    manualAssignments: [],
  };
}

test("General competition cannot starve an achievable AFP cap or invent an unchosen placeholder", async () => {
  const input = createAfpCompetitionInput();
  const output = await runPureAllocation(input);
  const audited = auditSchedule(input, output);
  assert.equal(audited.normalMinutes.get(1), 600);
  assert.equal(audited.normalMinutes.get(2), 720);
  assert.equal(audited.placeholderMinutes.size, 0);
  assert.equal(output.assignments.length, 8);
  assert.deepEqual(output.unallocatedShiftIds, [9]);
  assert.equal(output.fairnessDiagnostics.optimizationMethod, "global_milp");
});

test("unsupported optimizer policies fail visibly without returning a weaker or fabricated schedule", async () => {
  const input = {
    ...createAfpCompetitionInput(),
    allowExtremeNoAvailabilityAfpStacking: true,
  };
  const before = structuredClone(input);
  await assert.rejects(runPureAllocation(input), (error: unknown) => {
    assert.ok(error instanceof AllocationOptimizationError);
    assert.equal(error.code, "ALLOCATION_OPTIMIZATION_FAILED");
    assert.match(error.reason, /extreme_placeholder_stacking_not_supported/);
    return true;
  });
  assert.deepEqual(input, before);
});
