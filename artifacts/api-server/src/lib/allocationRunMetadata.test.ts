import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocationInputFingerprint,
  createAllocationRunMetadata,
  recordedAssignmentSource,
  recordedNormalHours,
  summarizeAllocationRun,
} from "./allocationRunMetadata.js";
import type { FairnessDiagnostics } from "./allocationEngine.js";
const shifts = [
  {
    id: 1,
    date: "2026-10-01",
    startTime: "09:00",
    endTime: "12:00",
    durationHours: 3,
  },
];
const responses = [
  {
    respondentId: 2,
    shiftId: 1,
    respondentCategory: "AFP",
    hasPenalty: false,
    penaltyHours: 0,
    hasAfpCap: true,
    afpHoursCap: 10,
  },
];
const fingerprint = allocationInputFingerprint(shifts, responses, [2]);
const settings = {
  allowNoAvailabilityAfpPlaceholders: true,
  noAvailabilityFallbackAfpIds: [2],
  afpRespondentIds: [2],
  allowAfpOverCapForAvailableShifts: false,
  preserveManualLocks: true,
};
const diagnostics = {
  optimizerStatus: "optimal",
  optimizationMethod: "global_milp",
  optimalCoverageProven: true,
  backToBackPairDays: 0,
} as FairnessDiagnostics;
const assignments = [
  {
    shiftId: 1,
    respondentId: 2,
    source: "engine_normal" as const,
    explanationCodes: [],
  },
];
const rows = [{ shiftId: 1, respondentId: 2, isManuallyAdjusted: false }];
const metadata = createAllocationRunMetadata(
  fingerprint,
  settings,
  diagnostics,
  assignments,
);

test("run guarantees and selected settings survive JSON persistence and restart", () => {
  const saved = JSON.parse(JSON.stringify(metadata));
  const summary = summarizeAllocationRun(saved, fingerprint, rows);
  assert.equal(summary.status, "current");
  assert.equal(summary.optimalCoverageProven, true);
  assert.deepEqual(summary.settings?.noAvailabilityFallbackAfpIds, [2]);
});
test("response or cap changes invalidate guarantees without falsifying historical sources", () => {
  for (const changed of [
    { ...responses[0], afpHoursCap: 9 },
    { ...responses[0], shiftId: 3 },
    { ...responses[0], respondentCategory: "General" },
  ]) {
    const summary = summarizeAllocationRun(
      metadata,
      allocationInputFingerprint(shifts, [changed], [2]),
      rows,
    );
    assert.equal(summary.status, "stale");
    assert.equal(summary.optimalCoverageProven, false);
    assert.equal(summary.optimizerStatus, "not_recorded");
    assert.equal(recordedAssignmentSource(metadata, rows[0]), "engine_normal");
  }
});
test("changed assignment owner invalidates guarantees and never inherits former provenance", () => {
  const changed = [{ ...rows[0], respondentId: 3 }];
  assert.equal(
    summarizeAllocationRun(metadata, fingerprint, changed).status,
    "stale",
  );
  assert.equal(recordedAssignmentSource(metadata, changed[0]), "not_recorded");
});
test("legacy rows do not imply optimizer success or authorized placeholders", () => {
  const summary = summarizeAllocationRun(null, fingerprint, rows);
  assert.equal(summary.status, "not_recorded");
  assert.equal(summary.optimalCoverageProven, false);
  assert.equal(recordedAssignmentSource(null, rows[0]), "not_recorded");
  assert.equal(
    recordedAssignmentSource(null, { ...rows[0], isManuallyAdjusted: true }),
    "manual",
  );
});
test("bounded solver stages remain visible after saving; manual changes invalidate them", () => {
  const bounded = {
    ...metadata,
    diagnostics: {
      ...diagnostics,
      optimizerStatus: "bounded:back_to_back_timedout",
    },
  };
  assert.match(
    summarizeAllocationRun(bounded, fingerprint, rows).warnings[0],
    /back_to_back_timedout/,
  );
  assert.equal(
    summarizeAllocationRun(
      { ...bounded, invalidatedReason: "Manual changes" },
      fingerprint,
      rows,
    ).status,
    "stale",
  );
});
test("fingerprints ignore input ordering but retain included membership and shift windows", () => {
  assert.equal(
    allocationInputFingerprint(shifts, [...responses].reverse(), [2, 2]),
    fingerprint,
  );
  assert.notEqual(
    allocationInputFingerprint(shifts, responses, [2, 3]),
    fingerprint,
  );
  assert.notEqual(
    allocationInputFingerprint(
      [{ ...shifts[0], endTime: "13:00" }],
      responses,
      [2],
    ),
    fingerprint,
  );
});
test("AFP cap accounting includes manual normal work but excludes only recorded placeholders", () => {
  const withPlaceholder = {
    ...metadata,
    assignments: [
      ...assignments,
      {
        shiftId: 3,
        respondentId: 2,
        source: "admin_no_availability_afp_placeholder",
        explanationCodes: [],
      },
    ],
  };
  const workload = [
    {
      shiftId: 1,
      respondentId: 2,
      isManuallyAdjusted: false,
      durationHours: 6,
    },
    { shiftId: 2, respondentId: 2, isManuallyAdjusted: true, durationHours: 3 },
    {
      shiftId: 3,
      respondentId: 2,
      isManuallyAdjusted: false,
      durationHours: 3,
    },
  ];
  assert.equal(recordedNormalHours(withPlaceholder, workload), 9);
  assert.equal(
    recordedNormalHours(null, workload),
    12,
    "unknown legacy provenance must not invent cap exemptions",
  );
  assert.equal(
    recordedNormalHours(
      withPlaceholder,
      workload.map((row) => ({ ...row, respondentId: 4 })),
    ),
    12,
  );
});
test("malformed historical metadata fails closed without crashing the allocation page", () => {
  assert.equal(
    summarizeAllocationRun(
      { ...metadata, assignments: [null] },
      fingerprint,
      rows,
    ).status,
    "not_recorded",
  );
  assert.equal(
    summarizeAllocationRun({ ...metadata, settings: {} }, fingerprint, rows)
      .status,
    "not_recorded",
  );
});

test("converting a historical placeholder to manual work counts its hours before the cap check", () => {
  const withPlaceholder = {
    ...metadata,
    assignments: [
      ...assignments,
      { shiftId: 3, respondentId: 2, source: "admin_no_availability_afp_placeholder", explanationCodes: [] },
    ],
  };
  const workload = [
    { shiftId: 1, respondentId: 2, isManuallyAdjusted: false, durationHours: 9 },
    { shiftId: 3, respondentId: 2, isManuallyAdjusted: false, durationHours: 3 },
  ];
  assert.equal(recordedNormalHours(withPlaceholder, workload), 9);
  const plannedHours = recordedNormalHours(withPlaceholder, workload, new Map([[3, "manual"]]));
  assert.equal(plannedHours, 12);
  assert.ok(plannedHours > 10, "a three-hour conversion must not bypass the ten-hour cap");
  assert.equal(
    recordedNormalHours(withPlaceholder, workload, new Map([[3, "admin_no_availability_afp_placeholder"]])),
    9,
    "an explicitly authorized replacement placeholder still stays separate",
  );
});

test("planned placeholder sources override manual history while untouched manual rows still count", () => {
  const workload = [
    { shiftId: 1, respondentId: 2, isManuallyAdjusted: true, durationHours: 9 },
    { shiftId: 3, respondentId: 2, isManuallyAdjusted: true, durationHours: 3 },
  ];
  assert.equal(recordedNormalHours(metadata, workload), 12);
  assert.equal(
    recordedNormalHours(metadata, workload, new Map([[3, "admin_no_availability_afp_placeholder"]])),
    9,
  );
});
