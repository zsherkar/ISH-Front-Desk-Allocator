import { createHash } from "node:crypto";
import type {
  AllocationAssignment,
  FairnessDiagnostics,
} from "./allocationEngine.js";

export interface AllocationRunSettings {
  allowNoAvailabilityAfpPlaceholders: boolean;
  noAvailabilityFallbackAfpIds: number[];
  afpRespondentIds: number[];
  allowAfpOverCapForAvailableShifts: boolean;
  preserveManualLocks: boolean;
}
export interface SavedAllocationRunMetadata {
  version: 1;
  savedAt: string;
  inputFingerprint: string;
  assignmentFingerprint: string;
  settings: AllocationRunSettings;
  diagnostics: FairnessDiagnostics;
  assignments: AllocationAssignment[];
  invalidatedReason?: string;
}
type InputShift = {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
};
type InputResponse = {
  respondentId: number;
  shiftId: number;
  respondentCategory: string;
  hasPenalty: boolean;
  penaltyHours: number;
  hasAfpCap: boolean;
  afpHoursCap: number;
};
type SavedRow = {
  respondentId: number;
  shiftId: number;
  isManuallyAdjusted: boolean;
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function allocationInputFingerprint(
  shifts: InputShift[],
  responses: InputResponse[],
  includedIds: number[],
): string {
  const included = new Set(includedIds);
  return digest({
    included: [...included].sort((a, b) => a - b),
    shifts: shifts
      .map((s) => [s.id, s.date, s.startTime, s.endTime, s.durationHours])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
    responses: responses
      .filter((r) => included.has(r.respondentId))
      .map((r) => [
        r.respondentId,
        r.shiftId,
        r.respondentCategory,
        r.hasPenalty,
        r.penaltyHours,
        r.hasAfpCap,
        r.afpHoursCap,
      ])
      .sort(
        (a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1]),
      ),
  });
}
export function allocationAssignmentFingerprint(rows: SavedRow[]): string {
  return digest(
    rows
      .map((r) => [r.shiftId, r.respondentId, r.isManuallyAdjusted])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
  );
}
export function readAllocationRunMetadata(
  value: unknown,
): SavedAllocationRunMetadata | null {
  if (!value || typeof value !== "object") return null;
  const record = value as SavedAllocationRunMetadata;
  if (
    record.version !== 1 ||
    typeof record.savedAt !== "string" ||
    typeof record.inputFingerprint !== "string" ||
    typeof record.assignmentFingerprint !== "string" ||
    !record.settings ||
    !record.diagnostics ||
    !Array.isArray(record.assignments) ||
    !Array.isArray(record.settings.noAvailabilityFallbackAfpIds)
  )
    return null;
  if (
    !Array.isArray(record.settings.afpRespondentIds) ||
    !record.assignments.every(
      (a) =>
        a &&
        Number.isSafeInteger(a.shiftId) &&
        Number.isSafeInteger(a.respondentId) &&
        typeof a.source === "string" &&
        [
          "engine_normal",
          "engine_back_to_back_emergency",
          "engine_no_availability_afp_fallback",
          "admin_no_availability_afp_placeholder",
          "engine_afp_cap_overflow_available",
          "manual",
        ].includes(a.source),
    )
  )
    return null;
  return record;
}
export function createAllocationRunMetadata(
  inputFingerprint: string,
  settings: AllocationRunSettings,
  diagnostics: FairnessDiagnostics,
  assignments: AllocationAssignment[],
): SavedAllocationRunMetadata {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    inputFingerprint,
    assignmentFingerprint: allocationAssignmentFingerprint(
      assignments.map((a) => ({
        ...a,
        isManuallyAdjusted: a.source === "manual",
      })),
    ),
    settings,
    diagnostics,
    assignments,
  };
}
export function summarizeAllocationRun(
  value: unknown,
  currentInputFingerprint: string,
  rows: SavedRow[],
) {
  const metadata = readAllocationRunMetadata(value);
  const current =
    metadata !== null &&
    !metadata.invalidatedReason &&
    metadata.inputFingerprint === currentInputFingerprint &&
    metadata.assignmentFingerprint === allocationAssignmentFingerprint(rows);
  const diagnostics = current ? metadata.diagnostics : undefined;
  const extra = diagnostics as
    | (FairnessDiagnostics & {
        policyVersion?: string;
        backToBackOptimalWithinFairness?: boolean;
      })
    | undefined;
  return {
    status: metadata
      ? current
        ? ("current" as const)
        : ("stale" as const)
      : ("not_recorded" as const),
    savedAt: metadata?.savedAt ?? null,
    policyVersion: extra?.policyVersion ?? null,
    optimizerStatus: diagnostics?.optimizerStatus ?? "not_recorded",
    optimizationMethod: diagnostics?.optimizationMethod ?? "not_recorded",
    optimalCoverageProven: diagnostics?.optimalCoverageProven ?? false,
    backToBackPairDays: diagnostics?.backToBackPairDays ?? null,
    backToBackOptimalWithinFairness:
      extra?.backToBackOptimalWithinFairness ?? false,
    warnings: !metadata
      ? [
          "Optimizer diagnostics and assignment provenance were not recorded for this older allocation.",
        ]
      : !current
        ? [
            metadata.invalidatedReason ??
              "Responses, policy settings, membership, shifts or saved assignments changed after this run. Rerun the audit before relying on its guarantees.",
          ]
        : diagnostics?.optimizerStatus !== "optimal"
          ? [
              `A validated allocation was retained, but some optimization stages were incomplete: ${diagnostics?.optimizerStatus ?? "unknown"}.`,
            ]
          : [],
    settings: metadata?.settings ?? null,
    fairnessRepairAttempted: diagnostics?.repairAttempted ?? false,
    fairnessRepairMoveCount: diagnostics?.successfulRepairMoves ?? 0,
  };
}

// Historical provenance is independent of whether today's inputs still match.
// Only use a stored source when the row's owner and manual flag still match.
export function recordedAssignmentSource(
  value: unknown,
  row: SavedRow,
): AllocationAssignment["source"] | "not_recorded" {
  if (row.isManuallyAdjusted) return "manual";
  const assignment = readAllocationRunMetadata(value)?.assignments.find(
    (a) =>
      a.shiftId === row.shiftId &&
      a.respondentId === row.respondentId &&
      a.source !== "manual",
  );
  return assignment?.source ?? "not_recorded";
}

export function recordedNormalHours(
  value: unknown,
  rows: Array<SavedRow & { durationHours: number }>,
  plannedSources: ReadonlyMap<number, AllocationAssignment["source"]> = new Map(),
): number {
  return rows.reduce((hours, row) => {
    // An adjustment can convert an old placeholder to available manual work.
    // Its new source must determine cap accounting before that change is saved.
    const source = plannedSources.get(row.shiftId) ?? recordedAssignmentSource(value, row);
    return (
      hours +
      (source === "admin_no_availability_afp_placeholder" ||
      source === "engine_no_availability_afp_fallback"
        ? 0
        : row.durationHours)
    );
  }, 0);
}
