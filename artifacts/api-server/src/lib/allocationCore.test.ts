import test from "node:test";
import assert from "node:assert/strict";
import {
  canAssignShiftToRespondent,
  deriveShiftSlotIndexes,
  hoursToMinutes,
  minutesToHours,
  solveNonAfpPenaltyTargets,
  stableShiftKey,
  type CoreShift,
} from "./allocationCore.js";

const toHours = (minutes: number) => Number(minutesToHours(minutes).toFixed(4));

function solveHours(penalties: number[], intendedHours: number, capacities?: number[]) {
  return solveNonAfpPenaltyTargets(
    penalties.map((penaltyHours, index) => ({
      respondentId: index + 1,
      penaltyMinutes: hoursToMinutes(penaltyHours),
      capacityMinutes: hoursToMinutes(capacities?.[index] ?? 200),
    })),
    hoursToMinutes(intendedHours),
  );
}

test("solves equal non-AFP targets when nobody is penalized", () => {
  const result = solveHours([0, 0, 0, 0], 80);

  assert.equal(toHours(result.baselineMinutes), 20);
  assert.deepEqual(result.targets.map((target) => toHours(target.targetMinutes)), [20, 20, 20, 20]);
});

test("keeps a 10-hour strike 10 hours below the non-penalized baseline", () => {
  const result = solveHours([0, 0, 0, 10], 110);

  assert.equal(toHours(result.baselineMinutes), 30);
  assert.deepEqual(result.targets.map((target) => toHours(target.targetMinutes)), [30, 30, 30, 20]);
});

test("supports mixed strike penalties", () => {
  const result = solveHours([0, 0, 10, 5], 105);

  assert.equal(toHours(result.baselineMinutes), 30);
  assert.deepEqual(result.targets.map((target) => toHours(target.targetMinutes)), [30, 30, 20, 25]);
});

test("supports everyone penalized with a virtual baseline", () => {
  const result = solveHours([5, 5, 5], 45);

  assert.equal(toHours(result.baselineMinutes), 20);
  assert.deepEqual(result.targets.map((target) => toHours(target.targetMinutes)), [15, 15, 15]);
});

test("supports one non-AFP without treating penalty as an exclusion", () => {
  const result = solveHours([10], 20);

  assert.equal(toHours(result.baselineMinutes), 30);
  assert.deepEqual(result.targets.map((target) => toHours(target.targetMinutes)), [20]);
});

test("supports fractional strike penalties in minute units", () => {
  const result = solveHours([0, 7.5], 52.5);

  assert.equal(toHours(result.baselineMinutes), 30);
  assert.deepEqual(result.targets.map((target) => toHours(target.targetMinutes)), [30, 22.5]);
});

test("truncates targets at zero when penalty exceeds baseline", () => {
  const result = solveHours([0, 100], 30);

  assert.equal(toHours(result.baselineMinutes), 30);
  assert.deepEqual(result.targets.map((target) => toHours(target.targetMinutes)), [30, 0]);
  assert.equal(result.targets[1].targetTruncatedAtZero, true);
});

test("capacity-adjusts targets and redistributes feasible hours", () => {
  const result = solveHours([0, 0, 0], 75, [10, 100, 100]);

  assert.equal(toHours(result.targets[0].targetMinutes), 10);
  assert.equal(toHours(result.targets[1].targetMinutes), 32.5);
  assert.equal(toHours(result.targets[2].targetMinutes), 32.5);
  assert.equal(result.targets[0].capacityLimited, true);
  assert.equal(result.capacityShortfallMinutes, 0);
});

test("reports capacity shortfall when requested non-AFP hours exceed availability", () => {
  const result = solveHours([0, 0], 40, [10, 15]);

  assert.equal(toHours(result.feasibleTotalMinutes), 25);
  assert.equal(toHours(result.capacityShortfallMinutes), 15);
  assert.deepEqual(result.targets.map((target) => toHours(target.targetMinutes)), [10, 15]);
});

const shifts = new Map<number, CoreShift>([
  [1, { id: 1, date: "2026-05-04", startTime: "09:00", endTime: "11:00", durationHours: 2 }],
  [2, { id: 2, date: "2026-05-04", startTime: "11:00", endTime: "14:00", durationHours: 3 }],
  [3, { id: 3, date: "2026-05-04", startTime: "14:00", endTime: "17:00", durationHours: 3 }],
  [4, { id: 4, date: "2026-05-04", startTime: "17:00", endTime: "20:00", durationHours: 3 }],
]);

test("allows adjacent same-day doubles as back-to-back emergency", () => {
  const result = canAssignShiftToRespondent({
    shiftId: 2,
    existingShiftIds: [1],
    shiftMap: shifts,
    isAvailable: true,
    assignmentSource: "engine_back_to_back_emergency",
    category: "General",
  });

  assert.equal(result.ok, true);
  assert.equal(result.wouldBeBackToBackEmergency, true);
});

test("rejects non-adjacent same-day doubles", () => {
  const result = canAssignShiftToRespondent({
    shiftId: 3,
    existingShiftIds: [1],
    shiftMap: shifts,
    isAvailable: true,
    assignmentSource: "engine_normal",
    category: "General",
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasonCodes.includes("BLOCKED_BY_NON_ADJACENT_SAME_DAY"));
});

test("rejects three shifts in one day", () => {
  const result = canAssignShiftToRespondent({
    shiftId: 3,
    existingShiftIds: [1, 2],
    shiftMap: shifts,
    isAvailable: true,
    assignmentSource: "engine_normal",
    category: "General",
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasonCodes.includes("BLOCKED_BY_MAX_TWO_SHIFTS_DAY"));
});

test("manual assignment unavailable block rejects manual shifts without selected availability", () => {
  const result = canAssignShiftToRespondent({
    shiftId: 1,
    existingShiftIds: [],
    shiftMap: shifts,
    isAvailable: false,
    assignmentSource: "manual",
    category: "General",
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasonCodes.includes("NO_AVAILABILITY"));
});

test("enforces AFP normal cap and rejects no-availability fallback overage", () => {
  const normal = canAssignShiftToRespondent({
    shiftId: 3,
    existingShiftIds: [],
    shiftMap: shifts,
    isAvailable: true,
    assignmentSource: "engine_normal",
    category: "AFP",
    currentNormalMinutes: hoursToMinutes(8),
    afpCapMinutes: hoursToMinutes(10),
  });
  const fallback = canAssignShiftToRespondent({
    shiftId: 3,
    existingShiftIds: [],
    shiftMap: shifts,
    isAvailable: false,
    assignmentSource: "engine_no_availability_afp_fallback",
    category: "AFP",
    currentNormalMinutes: hoursToMinutes(10),
    afpCapMinutes: hoursToMinutes(10),
  });

  assert.equal(normal.ok, false);
  assert.ok(normal.reasonCodes.includes("BLOCKED_BY_AFP_CAP"));
  assert.equal(fallback.ok, false);
  assert.ok(fallback.reasonCodes.includes("NO_AVAILABILITY"));
});

test("unstable_shift_key_response_mapping_regression keeps date-time-slot identity stable across regenerated IDs", () => {
  const original = [
    { id: 10, date: "2026-05-04", startTime: "09:00", endTime: "11:00", durationHours: 2 },
    { id: 11, date: "2026-05-04", startTime: "11:00", endTime: "14:00", durationHours: 3 },
  ];
  const regenerated = [
    { id: 910, date: "2026-05-04", startTime: "09:00", endTime: "11:00", durationHours: 2 },
    { id: 911, date: "2026-05-04", startTime: "11:00", endTime: "14:00", durationHours: 3 },
  ];

  const originalSlots = deriveShiftSlotIndexes(original);
  const regeneratedSlots = deriveShiftSlotIndexes(regenerated);

  const originalKey = stableShiftKey({ ...original[1], slotIndex: originalSlots.get(original[1].id) });
  const regeneratedKey = stableShiftKey({ ...regenerated[1], slotIndex: regeneratedSlots.get(regenerated[1].id) });

  assert.equal(originalKey, "2026-05-04|11:00|14:00|1");
  assert.equal(regeneratedKey, originalKey);
});
