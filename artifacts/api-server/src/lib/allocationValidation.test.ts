import test from "node:test";
import assert from "node:assert/strict";
import type {
  AllocationAssignment,
  AllocationRespondentInput,
  AllocationShiftInput,
  PureAllocationInput,
  PureAllocationOutput,
} from "./allocationEngine.js";
import {
  AllocationValidationError,
  assertValidAllocationInput,
  assertValidAllocationResult,
  validateAllocationInput,
  validateAllocationResult,
} from "./allocationValidation.js";

function shift(
  id: number,
  date = `2026-10-${String(id).padStart(2, "0")}`,
  startTime = "09:00",
  endTime = "12:00",
): AllocationShiftInput {
  return {
    id,
    date,
    startTime,
    endTime,
    durationHours: 3,
    dayType: "weekday",
    label: `${startTime}-${endTime}`,
  };
}

function respondent(
  id: number,
  available: number[],
  overrides: Partial<AllocationRespondentInput> = {},
): AllocationRespondentInput {
  return {
    id,
    name: `Person ${id}`,
    category: "AFP",
    availableShiftIds: new Set(available),
    hasAfpCap: true,
    afpHoursCap: 10,
    hasPenalty: false,
    penaltyHours: 0,
    allowNoAvailabilityFallback: true,
    ...overrides,
  };
}

function assignment(
  shiftId: number,
  respondentId = 1,
  source: AllocationAssignment["source"] = "engine_normal",
): AllocationAssignment {
  return { shiftId, respondentId, source, explanationCodes: [] };
}

// Expected schedules are assembled directly, without importing the allocation engine.
function result(
  input: PureAllocationInput,
  assignments: AllocationAssignment[],
): PureAllocationOutput {
  const plans = input.respondents.map((person) => {
    const own = assignments.filter((entry) => entry.respondentId === person.id);
    return {
      respondentId: person.id,
      name: person.name,
      category: person.category,
      shiftIds: own.map((entry) => entry.shiftId),
      totalHours: own.reduce(
        (sum, entry) =>
          sum +
          (input.shifts.find((item) => item.id === entry.shiftId)
            ?.durationHours ?? 0),
        0,
      ),
      isManuallyAdjusted: own.some((entry) => entry.source === "manual"),
      penaltyNote: null,
    };
  });
  const averageHours = plans.length
    ? plans.reduce((sum, plan) => sum + plan.totalHours, 0) / plans.length
    : 0;
  return {
    assignments,
    plans,
    averageHours,
    stdDev: plans.length
      ? Math.sqrt(
          plans.reduce(
            (sum, plan) => sum + (plan.totalHours - averageHours) ** 2,
            0,
          ) / plans.length,
        )
      : 0,
    unallocatedShiftIds: input.shifts
      .filter((item) => !assignments.some((entry) => entry.shiftId === item.id))
      .map((item) => item.id),
    fairnessDiagnostics: {
      nonPenalizedGeneralMeanHours: 0,
      nonPenalizedGeneralMedianHours: 0,
      nonPenalizedGeneralMinHours: 0,
      nonPenalizedGeneralMaxHours: 0,
      nonPenalizedGeneralRangeHours: 0,
      nonPenalizedGeneralStdDevHours: 0,
      maxDeviationFromMeanHours: 0,
      maxDeviationFromTargetHours: 0,
      sumSquaredDeviationFromTargetHours: 0,
      targetStdDevHours: 2,
      warningStdDevHours: 4,
      repairAttempted: false,
      successfulRepairMoves: 0,
      assignedShiftCountBeforeRepair: assignments.length,
      assignedShiftCountAfterRepair: assignments.length,
      highStdDevReasonCodes: [],
    },
  };
}

function codes(
  input: PureAllocationInput,
  output: PureAllocationOutput,
): Set<string> {
  return new Set(
    validateAllocationResult(input, output).map((issue) => issue.code),
  );
}

test("independent validation accepts explicit blanks and includes respondents with zero hours", () => {
  const input: PureAllocationInput = {
    shifts: [shift(1), shift(2)],
    respondents: [respondent(1, [1]), respondent(2, [])],
  };
  assert.deepEqual(
    validateAllocationResult(input, result(input, [assignment(1)])),
    [],
  );
  assert.deepEqual(
    validateAllocationResult(
      { shifts: [], respondents: [] },
      result({ shifts: [], respondents: [] }, []),
    ),
    [],
  );
});

test("selected zero-availability AFP placeholders are separate from the ten-hour normal cap", () => {
  const input: PureAllocationInput = {
    shifts: [shift(1), shift(2), shift(3), shift(4)],
    respondents: [respondent(1, [1, 2, 3])],
    allowNoAvailabilityAfpPlaceholders: true,
  };
  const assignments = [
    assignment(1),
    assignment(2),
    assignment(3),
    assignment(4, 1, "admin_no_availability_afp_placeholder"),
  ];
  const output = result(input, assignments);
  assert.equal(output.plans[0].totalHours, 12);
  assert.deepEqual(validateAllocationResult(input, output), []);
  output.assignments[3].source = "engine_no_availability_afp_fallback";
  assert.deepEqual(validateAllocationResult(input, output), []);
});

test("placeholder authorization requires all three: enabled, AFP category, and explicit selection", () => {
  const base: PureAllocationInput = {
    shifts: [shift(1)],
    respondents: [respondent(1, [])],
    allowNoAvailabilityAfpPlaceholders: true,
  };
  for (const input of [
    { ...base, allowNoAvailabilityAfpPlaceholders: false },
    {
      ...base,
      respondents: [
        respondent(1, [], { category: "General", hasAfpCap: false }),
      ],
    },
    {
      ...base,
      respondents: [respondent(1, [], { allowNoAvailabilityFallback: false })],
    },
  ]) {
    assert.ok(
      codes(
        input,
        result(input, [
          assignment(1, 1, "admin_no_availability_afp_placeholder"),
        ]),
      ).has("UNAUTHORIZED_AFP_PLACEHOLDER"),
    );
  }
});

test("placeholder source cannot hide available shifts or normal cap overflow", () => {
  const input: PureAllocationInput = {
    shifts: [shift(1)],
    respondents: [respondent(1, []), respondent(2, [1])],
    allowNoAvailabilityAfpPlaceholders: true,
  };
  assert.ok(
    codes(
      input,
      result(input, [
        assignment(1, 1, "admin_no_availability_afp_placeholder"),
      ]),
    ).has("PLACEHOLDER_HAS_AVAILABILITY"),
  );
  input.respondents = [respondent(1, [1], { afpHoursCap: 0 })];
  assert.ok(
    codes(
      input,
      result(input, [
        assignment(1, 1, "admin_no_availability_afp_placeholder"),
      ]),
    ).has("PLACEHOLDER_HAS_AVAILABILITY"),
  );
});

test("normal cap is hard unless overflow was explicitly enabled", () => {
  const input: PureAllocationInput = {
    shifts: [shift(1), shift(2), shift(3), shift(4)],
    respondents: [respondent(1, [1, 2, 3, 4])],
  };
  const assignments = [
    assignment(1),
    assignment(2),
    assignment(3),
    assignment(4, 1, "engine_afp_cap_overflow_available"),
  ];
  assert.ok(
    codes(input, result(input, assignments)).has("AFP_NORMAL_CAP_EXCEEDED"),
  );
  assert.ok(
    codes(input, result(input, assignments)).has(
      "UNAUTHORIZED_AFP_CAP_OVERFLOW",
    ),
  );
  input.allowAfpOverCapForAvailableShifts = true;
  assert.deepEqual(
    validateAllocationResult(input, result(input, assignments)),
    [],
  );
});

test("unavailable normal assignments cannot be legalized by source spoofing", () => {
  const input: PureAllocationInput = {
    shifts: [shift(1)],
    respondents: [respondent(1, [])],
  };
  for (const source of [
    "engine_normal",
    "engine_back_to_back_emergency",
    "engine_afp_cap_overflow_available",
    "manual",
  ] as const) {
    assert.ok(
      codes(input, result(input, [assignment(1, 1, source)])).has(
        "OUTSIDE_SUBMITTED_AVAILABILITY",
      ),
    );
  }
  for (const source of [
    "blank",
    "invented_source",
  ] as AllocationAssignment["source"][]) {
    assert.ok(
      codes(input, result(input, [assignment(1, 1, source)])).has(
        "INVALID_ASSIGNMENT_SOURCE",
      ),
    );
  }
});

test("same-day legality uses real adjoining times, not shift ID or position", () => {
  const input: PureAllocationInput = {
    shifts: [
      shift(17, "2026-10-01", "09:00", "12:00"),
      shift(42, "2026-10-01", "12:00", "15:00"),
    ],
    respondents: [respondent(1, [17, 42])],
  };
  assert.deepEqual(
    validateAllocationResult(
      input,
      result(input, [assignment(42), assignment(17)]),
    ),
    [],
  );
  input.shifts[1].startTime = "13:00";
  assert.ok(
    codes(input, result(input, [assignment(17), assignment(42)])).has(
      "NON_ADJACENT_SAME_DAY_SHIFTS",
    ),
  );
  input.shifts[1].startTime = "11:00";
  assert.ok(
    codes(input, result(input, [assignment(17), assignment(42)])).has(
      "NON_ADJACENT_SAME_DAY_SHIFTS",
    ),
  );
});

test("placeholder hours obey adjacent-only and at most two per day even under the legacy extreme flag", () => {
  const input: PureAllocationInput = {
    shifts: [
      shift(1, "2026-10-01", "09:00", "12:00"),
      shift(2, "2026-10-01", "12:00", "15:00"),
      shift(3, "2026-10-01", "15:00", "18:00"),
    ],
    respondents: [respondent(1, [])],
    allowNoAvailabilityAfpPlaceholders: true,
    allowExtremeNoAvailabilityAfpStacking: true,
  };
  const entries = input.shifts.map((item) =>
    assignment(item.id, 1, "admin_no_availability_afp_placeholder"),
  );
  assert.deepEqual(
    validateAllocationResult(input, result(input, entries.slice(0, 2))),
    [],
  );
  assert.ok(
    codes(input, result(input, entries)).has("MORE_THAN_TWO_SHIFTS_IN_DAY"),
  );
  assert.ok(
    codes(input, result(input, [entries[0], entries[2]])).has(
      "NON_ADJACENT_SAME_DAY_SHIFTS",
    ),
  );
});

test("normal and placeholder assignments share one same-day limit", () => {
  const input: PureAllocationInput = {
    shifts: [
      shift(1, "2026-10-01", "09:00", "12:00"),
      shift(2, "2026-10-01", "15:00", "18:00"),
    ],
    respondents: [respondent(1, [1])],
    allowNoAvailabilityAfpPlaceholders: true,
  };
  assert.ok(
    codes(
      input,
      result(input, [
        assignment(1),
        assignment(2, 1, "admin_no_availability_afp_placeholder"),
      ]),
    ).has("NON_ADJACENT_SAME_DAY_SHIFTS"),
  );
});

test("manual assignments require exact locks and preserve them with honest provenance", () => {
  const input: PureAllocationInput = {
    shifts: [shift(1)],
    respondents: [respondent(1, [1]), respondent(2, [1])],
    manualAssignments: [{ shiftId: 1, respondentId: 1 }],
  };
  assert.deepEqual(
    validateAllocationResult(
      input,
      result(input, [assignment(1, 1, "manual")]),
    ),
    [],
  );
  assert.ok(
    codes(input, result(input, [assignment(1)])).has(
      "MANUAL_LOCK_NOT_PRESERVED",
    ),
  );
  assert.ok(
    codes(input, result(input, [assignment(1, 2, "manual")])).has(
      "UNAUTHORIZED_MANUAL_SOURCE",
    ),
  );
  assert.ok(codes(input, result(input, [])).has("MANUAL_LOCK_NOT_PRESERVED"));
});

test("explicit manual locks do not bypass submitted availability, AFP caps, or same-day rules", () => {
  const input: PureAllocationInput = {
    shifts: [
      shift(1, "2026-10-01", "09:00", "12:00"),
      shift(2, "2026-10-01", "15:00", "18:00"),
    ],
    respondents: [respondent(1, [1], { afpHoursCap: 3 })],
    manualAssignments: [
      { shiftId: 1, respondentId: 1 },
      { shiftId: 2, respondentId: 1 },
    ],
  };
  const errors = codes(
    input,
    result(input, [assignment(1, 1, "manual"), assignment(2, 1, "manual")]),
  );
  assert.ok(errors.has("OUTSIDE_SUBMITTED_AVAILABILITY"));
  assert.ok(errors.has("AFP_NORMAL_CAP_EXCEEDED"));
  assert.ok(errors.has("NON_ADJACENT_SAME_DAY_SHIFTS"));
});

test("every shift has exactly one disposition and no assignment can escape the input membership", () => {
  const input: PureAllocationInput = {
    shifts: [shift(1), shift(2)],
    respondents: [respondent(1, [1, 2])],
  };
  const output = result(input, [assignment(1), assignment(1)]);
  output.assignments.push(assignment(99, 99));
  output.unallocatedShiftIds = [1, 1, 88];
  const errors = codes(input, output);
  for (const code of [
    "DUPLICATE_SHIFT_ASSIGNMENT",
    "UNKNOWN_ASSIGNMENT_SHIFT",
    "UNKNOWN_ASSIGNMENT_RESPONDENT",
    "ASSIGNED_AND_UNALLOCATED",
    "DUPLICATE_UNALLOCATED_SHIFT",
    "UNKNOWN_UNALLOCATED_SHIFT",
    "UNACCOUNTED_SHIFT",
  ]) {
    assert.ok(errors.has(code), code);
  }
});

test("plan IDs, total hours, category, and population statistics are independently reconciled", () => {
  const input: PureAllocationInput = {
    shifts: [shift(1)],
    respondents: [respondent(1, [1]), respondent(2, [])],
  };
  const output = result(input, [assignment(1)]);
  output.plans[0].shiftIds = [1, 1];
  output.plans[0].totalHours = 99;
  output.plans[0].category = "General";
  output.plans[0].isManuallyAdjusted = true;
  output.plans[1].respondentId = 77;
  output.plans.push({ ...output.plans[0] });
  output.averageHours = 99;
  output.stdDev = NaN;
  const errors = codes(input, output);
  for (const code of [
    "PLAN_ASSIGNMENT_MISMATCH",
    "PLAN_HOURS_MISMATCH",
    "PLAN_CATEGORY_MISMATCH",
    "PLAN_MANUAL_FLAG_MISMATCH",
    "UNKNOWN_PLAN_RESPONDENT",
    "DUPLICATE_RESPONDENT_PLAN",
    "MISSING_RESPONDENT_PLAN",
    "AVERAGE_HOURS_MISMATCH",
    "STANDARD_DEVIATION_MISMATCH",
  ]) {
    assert.ok(errors.has(code), code);
  }
});

test("invalid input identifiers, durations, availability, caps, and locks cannot produce a clean certificate", () => {
  const input: PureAllocationInput = {
    shifts: [shift(1), { ...shift(1), durationHours: NaN }],
    respondents: [respondent(1, [88], { afpHoursCap: -1 }), respondent(1, [])],
    manualAssignments: [
      { shiftId: 99, respondentId: 99 },
      { shiftId: 99, respondentId: 1 },
    ],
  };
  const errors = codes(input, result(input, []));
  for (const code of [
    "INVALID_INPUT_SHIFT_ID",
    "INVALID_INPUT_RESPONDENT_ID",
    "INVALID_SHIFT_DURATION",
    "UNKNOWN_AVAILABILITY_SHIFT",
    "INVALID_AFP_CAP",
    "UNKNOWN_MANUAL_LOCK",
    "DUPLICATE_MANUAL_LOCK",
  ]) {
    assert.ok(errors.has(code), code);
  }
});

test("assert helper returns a structured error and leaves caller input/output untouched", () => {
  const input: PureAllocationInput = {
    shifts: [shift(1)],
    respondents: [respondent(1, [])],
  };
  const output = result(input, [assignment(1)]);
  const before = structuredClone({ input, output });
  assert.throws(
    () => assertValidAllocationResult(input, output),
    (error: unknown) => {
      assert.ok(error instanceof AllocationValidationError);
      assert.ok(
        error.issues.some(
          (issue) =>
            issue.code === "OUTSIDE_SUBMITTED_AVAILABILITY" &&
            issue.respondentId === 1 &&
            issue.shiftId === 1,
        ),
      );
      return true;
    },
  );
  assert.deepEqual({ input, output }, before);
});

test("input validation rejects impossible manual locks before solving or silently normalizing them", () => {
  const input: PureAllocationInput = {
    shifts: [
      shift(1, "2026-10-01", "09:00", "12:00"),
      shift(2, "2026-10-01", "15:00", "18:00"),
    ],
    respondents: [respondent(1, [1], { afpHoursCap: 3, penaltyHours: NaN })],
    manualAssignments: [
      { shiftId: 1, respondentId: 1 },
      { shiftId: 2, respondentId: 1 },
    ],
  };
  const errors = new Set(
    validateAllocationInput(input).map((issue) => issue.code),
  );
  for (const code of [
    "MANUAL_LOCK_OUTSIDE_AVAILABILITY",
    "MANUAL_LOCKS_EXCEED_AFP_CAP",
    "MANUAL_LOCKS_VIOLATE_SAME_DAY_RULE",
    "INVALID_PENALTY_HOURS",
  ]) {
    assert.ok(errors.has(code), code);
  }
  assert.throws(
    () => assertValidAllocationInput(input),
    AllocationValidationError,
  );
  const valid: PureAllocationInput = {
    shifts: [shift(1)],
    respondents: [respondent(1, [1])],
    manualAssignments: [{ shiftId: 1, respondentId: 1 }],
  };
  assert.doesNotThrow(() => assertValidAllocationInput(valid));
});

test("exhaustive 256 small schedules agree with a hand-derived feasibility oracle", () => {
  const input: PureAllocationInput = {
    shifts: [
      shift(1, "2026-10-01", "09:00", "12:00"),
      shift(2, "2026-10-01", "12:00", "15:00"),
      shift(3, "2026-10-01", "18:00", "21:00"),
      shift(4, "2026-10-02", "09:00", "12:00"),
    ],
    respondents: [
      respondent(1, [1, 2], { category: "General", hasAfpCap: false }),
      respondent(2, [2, 3], { afpHoursCap: 3 }),
      respondent(3, []),
    ],
    allowNoAvailabilityAfpPlaceholders: true,
  };
  let validCount = 0;
  let invalidCount = 0;
  // Each digit chooses blank, General, capped AFP, or selected AFP placeholder.
  // The oracle is specific to the four known shifts, so it shares no validator algorithm.
  for (let encoded = 0; encoded < 4 ** 4; encoded++) {
    const choices = [0, 1, 2, 3].map(
      (position) => Math.floor(encoded / 4 ** position) % 4,
    );
    const assignments = choices.flatMap((choice, index) =>
      choice === 0
        ? []
        : [
            assignment(
              index + 1,
              choice,
              choice === 3
                ? "admin_no_availability_afp_placeholder"
                : "engine_normal",
            ),
          ],
    );
    const afpCount = choices.filter((choice) => choice === 2).length;
    const expectedValid =
      choices.every(
        (choice, index) =>
          choice === 0 ||
          (choice === 1 && (index === 0 || index === 1)) ||
          (choice === 2 && (index === 1 || index === 2)) ||
          (choice === 3 && index === 3),
      ) && afpCount <= 1;
    const output = result(input, assignments);
    const issues = validateAllocationResult(input, output);
    assert.equal(
      issues.length === 0,
      expectedValid,
      `choices=${choices.join(",")} issues=${issues.map((issue) => issue.code).join(",")}`,
    );
    // Enumeration and order of plans, availability, and assignments must not change legality.
    const permutedInput = {
      ...input,
      shifts: [...input.shifts].reverse(),
      respondents: [...input.respondents].reverse(),
    };
    const permutedOutput = {
      ...output,
      plans: [...output.plans].reverse(),
      assignments: [...output.assignments].reverse(),
    };
    assert.equal(
      validateAllocationResult(permutedInput, permutedOutput).length === 0,
      expectedValid,
    );
    if (expectedValid) validCount++;
    else invalidCount++;
  }
  assert.equal(validCount, 20);
  assert.equal(invalidCount, 236);
});

test("unknown availability cannot disappear through Map normalization", () => {
  const input: PureAllocationInput = {
    shifts: [shift(1)],
    respondents: [respondent(1, [1, 99])],
  };
  assert.ok(
    validateAllocationInput(input).some(
      (issue) => issue.code === "UNKNOWN_AVAILABILITY_SHIFT",
    ),
  );
  assert.throws(
    () => assertValidAllocationInput(input),
    AllocationValidationError,
  );
});
