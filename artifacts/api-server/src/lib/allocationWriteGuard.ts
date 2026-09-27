import { createHash } from "node:crypto";

interface SurveyWriteState {
  status: string;
  updatedAt: Date | string;
  allocationIncludedRespondentIds: number[] | null;
  allocationRunMetadata: unknown;
}
interface AssignmentWriteState {
  shiftId: number;
  respondentId: number;
  isManuallyAdjusted: boolean;
  penaltyNote: string | null;
}

/** Protect edits made while optimization runs outside the database transaction. */
export function allocationWriteStateFingerprint(
  survey: SurveyWriteState | undefined,
  assignments: AssignmentWriteState[],
): string {
  const state = survey ? {
    status: survey.status,
    updatedAt: new Date(survey.updatedAt).toISOString(),
    includedIds: survey.allocationIncludedRespondentIds === null
      ? null : [...survey.allocationIncludedRespondentIds].sort((a, b) => a - b),
    metadata: survey.allocationRunMetadata,
    assignments: assignments.map((row) => [row.shiftId, row.respondentId, row.isManuallyAdjusted, row.penaltyNote])
      .sort((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1])),
  } : null;
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

export class AllocationWriteConflictError extends Error {
  readonly code = "ALLOCATION_INPUT_CHANGED";
  constructor() {
    super("Availability, respondent rules, saved assignments, or survey settings changed during optimization. Run allocation again. The saved allocation was unchanged.");
    this.name = "AllocationWriteConflictError";
  }
}

export function assertAllocationWriteUnchanged(
  baseline: { inputFingerprint: string; stateFingerprint: string },
  current: { inputFingerprint: string; stateFingerprint: string; surveyStatus: string | undefined },
): void {
  if (current.surveyStatus !== "closed" || baseline.inputFingerprint !== current.inputFingerprint || baseline.stateFingerprint !== current.stateFingerprint) {
    throw new AllocationWriteConflictError();
  }
}

/** Drizzle may wrap PostgreSQL's serialization/deadlock error in a cause. */
export function isAllocationWriteConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const detail = current as { code?: string; cause?: unknown };
    if (detail.code === "ALLOCATION_INPUT_CHANGED" || detail.code === "40001" || detail.code === "40P01") return true;
    current = detail.cause;
  }
  return false;
}
