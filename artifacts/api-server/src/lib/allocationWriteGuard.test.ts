import test from "node:test";
import assert from "node:assert/strict";
import {
  AllocationWriteConflictError,
  allocationWriteStateFingerprint,
  assertAllocationWriteUnchanged,
  isAllocationWriteConflict,
} from "./allocationWriteGuard.js";

const survey = {
  status: "closed",
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  allocationIncludedRespondentIds: [1, 2],
  allocationRunMetadata: { version: 1, settings: { afpRespondentIds: [1] } },
};
const rows = [
  { respondentId: 1, shiftId: 7, isManuallyAdjusted: true, penaltyNote: null },
  { respondentId: 2, shiftId: 8, isManuallyAdjusted: false, penaltyNote: null },
];
const baseline = { inputFingerprint: "original-availability-caps-and-penalties", stateFingerprint: allocationWriteStateFingerprint(survey, rows) };
const current = { ...baseline, surveyStatus: "closed" };

test("unchanged allocation state remains valid regardless of row or inclusion ordering", () => {
  const unchanged = allocationWriteStateFingerprint({ ...survey, allocationIncludedRespondentIds: [2, 1] }, [...rows].reverse());
  assert.equal(unchanged, baseline.stateFingerprint);
  assert.doesNotThrow(() => assertAllocationWriteUnchanged(baseline, { ...current, stateFingerprint: unchanged }));
});

test("manual removal, addition, reassignment, or provenance edits during worker execution reject the save", () => {
  for (const changed of [
    rows.slice(1),
    [...rows, { respondentId: 1, shiftId: 9, isManuallyAdjusted: true, penaltyNote: null }],
    [{ ...rows[0], respondentId: 2 }, rows[1]],
    [{ ...rows[0], isManuallyAdjusted: false }, rows[1]],
    [{ ...rows[0], penaltyNote: "Changed while solving" }, rows[1]],
  ]) {
    assert.throws(() => assertAllocationWriteUnchanged(baseline, {
      ...current, stateFingerprint: allocationWriteStateFingerprint(survey, changed),
    }), AllocationWriteConflictError);
  }
});

test("survey reopening, membership changes, another allocation run, and policy edits reject a stale save", () => {
  for (const changed of [
    { ...survey, status: "open" },
    { ...survey, allocationIncludedRespondentIds: [1] },
    { ...survey, updatedAt: new Date("2026-10-01T00:01:00Z") },
    { ...survey, allocationRunMetadata: { version: 1, settings: { afpRespondentIds: [1, 2] } } },
  ]) {
    assert.throws(() => assertAllocationWriteUnchanged(baseline, {
      inputFingerprint: baseline.inputFingerprint,
      stateFingerprint: allocationWriteStateFingerprint(changed, rows),
      surveyStatus: changed.status,
    }), AllocationWriteConflictError);
  }
  assert.throws(() => assertAllocationWriteUnchanged(baseline, { ...current, surveyStatus: undefined }), AllocationWriteConflictError);
});

test("availability, cap, or strike fingerprint changes reject a stale save even with unchanged assignments", () => {
  for (const inputFingerprint of ["changed-availability", "changed-afp-cap", "changed-strike"]) {
    assert.throws(() => assertAllocationWriteUnchanged(baseline, { ...current, inputFingerprint }), AllocationWriteConflictError);
  }
});

test("an open survey never permits saving even if its state hash matches", () => {
  const stateFingerprint = allocationWriteStateFingerprint({ ...survey, status: "open" }, rows);
  assert.throws(() => assertAllocationWriteUnchanged(
    { ...baseline, stateFingerprint },
    { ...current, stateFingerprint, surveyStatus: "open" },
  ), AllocationWriteConflictError);
});

test("wrapped PostgreSQL serialization and deadlock failures become retryable conflicts", () => {
  for (const code of ["40001", "40P01"]) {
    assert.equal(isAllocationWriteConflict({ code }), true);
    assert.equal(isAllocationWriteConflict(new Error("Query failed", { cause: { code } })), true);
  }
  assert.equal(isAllocationWriteConflict(new AllocationWriteConflictError()), true);
  assert.equal(isAllocationWriteConflict({ code: "23505" }), false);
  assert.equal(isAllocationWriteConflict(new Error("Unrelated failure")), false);
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  assert.equal(isAllocationWriteConflict(cycle), false);
});
