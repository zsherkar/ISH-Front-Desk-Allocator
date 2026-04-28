import {
  type AssignmentSource,
  canAssignShiftToRespondent,
  deriveShiftSlotIndexes,
  hoursToMinutes,
  minutesToHours,
  sameDayAllocationTier,
  solveNonAfpPenaltyTargets,
  stableShiftKey,
} from "./allocationCore.js";
import { safeDisplayName } from "./inputValidation.js";

export interface AllocationOptions {
  surveyId: number;
  afpRespondentIds: number[];
  afpUnclaimedShiftRespondentIds?: number[];
  includedRespondentIds?: number[];
  allowAfpOverCapForAvailableShifts?: boolean;
  existingManualAssignments?: Array<{ respondentId: number; shiftId: number }>;
}

export interface AllocationPlan {
  respondentId: number;
  name: string;
  category: string;
  shiftIds: number[];
  totalHours: number;
  isManuallyAdjusted: boolean;
  penaltyNote: string | null;
}

export interface AllocationAssignment {
  respondentId: number;
  shiftId: number;
  source: AssignmentSource;
  explanationCodes: string[];
}

export interface AllocationShiftInput {
  id: number;
  date: string;
  dayType: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  label: string;
}

export interface AllocationRespondentInput {
  id: number;
  name: string;
  category: "AFP" | "General";
  availableShiftIds: Set<number>;
  hasPenalty: boolean;
  penaltyHours: number;
  afpHoursCap: number;
  allowNoAvailabilityFallback: boolean;
}

interface ShiftInfo extends AllocationShiftInput {
  slotIndex: number;
  stableShiftKey: string;
}

interface RespondentInfo extends AllocationRespondentInput {
  availableCapacityMinutes: number;
}

interface Candidate {
  respondent: RespondentInfo;
  shift: ShiftInfo;
  source: AssignmentSource;
  dayTier: 0 | 1;
  currentMinutes: number;
  afterMinutes: number;
  targetMinutes: number;
  capacityMinutes: number;
  sourceRank: number;
}

export interface PureAllocationInput {
  shifts: AllocationShiftInput[];
  respondents: AllocationRespondentInput[];
  allowAfpOverCapForAvailableShifts?: boolean;
  manualAssignments?: Array<{ respondentId: number; shiftId: number }>;
}

export interface PureAllocationOutput {
  plans: AllocationPlan[];
  assignments: AllocationAssignment[];
  averageHours: number;
  stdDev: number;
  unallocatedShiftIds: number[];
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calcMinutes(shiftIds: number[], shiftMap: Map<number, ShiftInfo>): number {
  return shiftIds.reduce((sum, id) => sum + hoursToMinutes(shiftMap.get(id)?.durationHours ?? 0), 0);
}

function normalizeShifts(shifts: AllocationShiftInput[]): ShiftInfo[] {
  const slotIndexes = deriveShiftSlotIndexes(shifts);
  return shifts
    .map((shift) => {
      const slotIndex = slotIndexes.get(shift.id) ?? 0;
      return {
        ...shift,
        slotIndex,
        stableShiftKey: stableShiftKey({ ...shift, slotIndex }),
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.startTime.localeCompare(b.startTime) ||
        a.endTime.localeCompare(b.endTime) ||
        a.slotIndex - b.slotIndex ||
        a.id - b.id,
    );
}

function assignmentSourceRank(source: AssignmentSource): number {
  switch (source) {
    case "engine_normal":
      return 0;
    case "engine_back_to_back_emergency":
      return 1;
    case "engine_afp_cap_overflow_available":
      return 2;
    case "engine_no_availability_afp_fallback":
      return 3;
    case "manual":
      return 4;
    case "blank":
      return 5;
  }
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
  if (a.dayTier !== b.dayTier) return a.dayTier - b.dayTier;

  const aDeficit = a.targetMinutes - a.currentMinutes;
  const bDeficit = b.targetMinutes - b.currentMinutes;
  if (Math.abs(aDeficit - bDeficit) > 0.5) return bDeficit - aDeficit;

  const aOverage = Math.max(0, a.afterMinutes - a.targetMinutes);
  const bOverage = Math.max(0, b.afterMinutes - b.targetMinutes);
  if (Math.abs(aOverage - bOverage) > 0.5) return aOverage - bOverage;

  if (a.currentMinutes !== b.currentMinutes) return a.currentMinutes - b.currentMinutes;
  if (a.capacityMinutes !== b.capacityMinutes) return a.capacityMinutes - b.capacityMinutes;
  return a.respondent.name.localeCompare(b.respondent.name) || a.respondent.id - b.respondent.id;
}

export function runPureAllocation(input: PureAllocationInput): PureAllocationOutput {
  const shifts = normalizeShifts(input.shifts);
  const shiftMap = new Map(shifts.map((shift) => [shift.id, shift]));
  const availabilityByShiftId = new Map<number, Set<number>>();
  for (const shift of shifts) availabilityByShiftId.set(shift.id, new Set());

  const respondents: RespondentInfo[] = input.respondents
    .map((respondent) => ({
      ...respondent,
      availableCapacityMinutes: Array.from(respondent.availableShiftIds).reduce(
        (sum, shiftId) => sum + hoursToMinutes(shiftMap.get(shiftId)?.durationHours ?? 0),
        0,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

  for (const respondent of respondents) {
    for (const shiftId of respondent.availableShiftIds) {
      availabilityByShiftId.get(shiftId)?.add(respondent.id);
    }
  }

  const respondentById = new Map(respondents.map((respondent) => [respondent.id, respondent]));
  const assignmentsByRespondentId = new Map<number, AllocationAssignment[]>();
  for (const respondent of respondents) assignmentsByRespondentId.set(respondent.id, []);
  const assignmentByShiftId = new Map<number, AllocationAssignment>();

  const allocatedShiftIdsFor = (respondentId: number) =>
    (assignmentsByRespondentId.get(respondentId) ?? []).map((assignment) => assignment.shiftId);

  const normalAfpMinutesFor = (respondentId: number) =>
    (assignmentsByRespondentId.get(respondentId) ?? [])
      .filter(
        (assignment) =>
          assignment.source === "engine_normal" ||
          assignment.source === "engine_back_to_back_emergency",
      )
      .reduce((sum, assignment) => sum + hoursToMinutes(shiftMap.get(assignment.shiftId)?.durationHours ?? 0), 0);

  const addAssignment = (assignment: AllocationAssignment) => {
    const current = assignmentsByRespondentId.get(assignment.respondentId) ?? [];
    assignmentsByRespondentId.set(assignment.respondentId, [...current, assignment]);
    assignmentByShiftId.set(assignment.shiftId, assignment);
  };

  const removeAssignment = (shiftId: number) => {
    const existing = assignmentByShiftId.get(shiftId);
    if (!existing) return;
    assignmentsByRespondentId.set(
      existing.respondentId,
      (assignmentsByRespondentId.get(existing.respondentId) ?? []).filter(
        (assignment) => assignment.shiftId !== shiftId,
      ),
    );
    assignmentByShiftId.delete(shiftId);
  };

  for (const manual of input.manualAssignments ?? []) {
    const respondent = respondentById.get(manual.respondentId);
    const shift = shiftMap.get(manual.shiftId);
    if (!respondent || !shift || assignmentByShiftId.has(shift.id)) continue;
    addAssignment({
      respondentId: respondent.id,
      shiftId: shift.id,
      source: "manual",
      explanationCodes: ["MANUAL_OVERRIDE"],
    });
  }

  const normalAssignableShifts = shifts.filter((shift) => (availabilityByShiftId.get(shift.id)?.size ?? 0) > 0);
  const intendedAfpNormalMinutes = respondents
    .filter((respondent) => respondent.category === "AFP")
    .reduce(
      (sum, respondent) =>
        sum + Math.min(hoursToMinutes(respondent.afpHoursCap), respondent.availableCapacityMinutes),
      0,
    );
  const intendedNonAfpMinutes = Math.max(
    0,
    normalAssignableShifts.reduce((sum, shift) => sum + hoursToMinutes(shift.durationHours), 0) -
      intendedAfpNormalMinutes,
  );
  const generalRespondents = respondents.filter((respondent) => respondent.category === "General");
  const targetResult = solveNonAfpPenaltyTargets(
    generalRespondents.map((respondent) => ({
      respondentId: respondent.id,
      penaltyMinutes: hoursToMinutes(respondent.hasPenalty ? respondent.penaltyHours : 0),
      capacityMinutes: respondent.availableCapacityMinutes,
    })),
    intendedNonAfpMinutes,
  );
  const targetMinutesByRespondentId = new Map<number, number>();
  for (const target of targetResult.targets) {
    targetMinutesByRespondentId.set(target.respondentId, target.targetMinutes);
  }
  for (const respondent of respondents) {
    if (respondent.category === "AFP") {
      targetMinutesByRespondentId.set(respondent.id, hoursToMinutes(respondent.afpHoursCap));
    }
  }

  const candidateFor = (
    shift: ShiftInfo,
    respondent: RespondentInfo,
    mode: "available" | "no_availability_fallback",
    allowAfpCapOverflowAvailable: boolean,
  ): Candidate | null => {
    if (assignmentByShiftId.has(shift.id)) return null;
    const isAvailable = respondent.availableShiftIds.has(shift.id);
    if (mode === "available" && !isAvailable) return null;
    if (
      mode === "no_availability_fallback" &&
      ((availabilityByShiftId.get(shift.id)?.size ?? 0) > 0 ||
        respondent.category !== "AFP" ||
        !respondent.allowNoAvailabilityFallback)
    ) {
      return null;
    }

    const existingShiftIds = allocatedShiftIdsFor(respondent.id);
    const dayTier = sameDayAllocationTier(shift.id, existingShiftIds, shiftMap);
    if (dayTier >= 2) return null;
    const safeDayTier: 0 | 1 = dayTier === 1 ? 1 : 0;

    let source: AssignmentSource =
      mode === "no_availability_fallback"
        ? "engine_no_availability_afp_fallback"
        : safeDayTier === 1
          ? "engine_back_to_back_emergency"
          : "engine_normal";

    const validation = canAssignShiftToRespondent({
      shiftId: shift.id,
      existingShiftIds,
      shiftMap,
      isAvailable,
      assignmentSource: source,
      category: respondent.category,
      currentNormalMinutes: normalAfpMinutesFor(respondent.id),
      afpCapMinutes: hoursToMinutes(respondent.afpHoursCap),
    });

    if (!validation.ok) {
      const capOnly =
        respondent.category === "AFP" &&
        mode === "available" &&
        allowAfpCapOverflowAvailable &&
        validation.reasonCodes.length === 1 &&
        validation.reasonCodes[0] === "BLOCKED_BY_AFP_CAP";
      if (!capOnly) return null;
      source = "engine_afp_cap_overflow_available";
    }

    const currentMinutes = calcMinutes(existingShiftIds, shiftMap);
    return {
      respondent,
      shift,
      source,
      dayTier: safeDayTier,
      currentMinutes,
      afterMinutes: currentMinutes + hoursToMinutes(shift.durationHours),
      targetMinutes: targetMinutesByRespondentId.get(respondent.id) ?? 0,
      capacityMinutes: respondent.availableCapacityMinutes,
      sourceRank: assignmentSourceRank(source),
    };
  };

  const assignBest = (
    shift: ShiftInfo,
    candidateRespondents: RespondentInfo[],
    mode: "available" | "no_availability_fallback",
    allowAfpCapOverflowAvailable: boolean,
  ): boolean => {
    const candidates = candidateRespondents
      .map((respondent) => candidateFor(shift, respondent, mode, allowAfpCapOverflowAvailable))
      .filter((candidate): candidate is Candidate => candidate !== null)
      .sort(compareCandidates);
    const best = candidates[0];
    if (!best) return false;
    addAssignment({
      respondentId: best.respondent.id,
      shiftId: shift.id,
      source: best.source,
      explanationCodes:
        best.source === "engine_afp_cap_overflow_available"
          ? ["BLOCKED_BY_AFP_CAP"]
          : best.source === "engine_no_availability_afp_fallback"
            ? ["NO_AVAILABILITY"]
            : [],
    });
    return true;
  };

  const availableShiftOrder = shifts
    .filter((shift) => (availabilityByShiftId.get(shift.id)?.size ?? 0) > 0)
    .sort((a, b) => {
      const aAvailable = availabilityByShiftId.get(a.id)?.size ?? 0;
      const bAvailable = availabilityByShiftId.get(b.id)?.size ?? 0;
      const aGeneral = respondents.filter((respondent) => respondent.category === "General" && respondent.availableShiftIds.has(a.id)).length;
      const bGeneral = respondents.filter((respondent) => respondent.category === "General" && respondent.availableShiftIds.has(b.id)).length;
      return (
        aAvailable - bAvailable ||
        aGeneral - bGeneral ||
        hoursToMinutes(b.durationHours) - hoursToMinutes(a.durationHours) ||
        a.date.localeCompare(b.date) ||
        a.slotIndex - b.slotIndex ||
        a.id - b.id
      );
    });

  for (const shift of availableShiftOrder) {
    if (assignmentByShiftId.has(shift.id)) continue;
    if (assignBest(shift, respondents, "available", false)) continue;
    if (input.allowAfpOverCapForAvailableShifts) {
      assignBest(shift, respondents.filter((respondent) => respondent.category === "AFP"), "available", true);
    }
  }

  const repairBlankWithAvailability = (shift: ShiftInfo): boolean => {
    if (assignBest(shift, respondents, "available", false)) return true;
    if (
      input.allowAfpOverCapForAvailableShifts &&
      assignBest(shift, respondents.filter((respondent) => respondent.category === "AFP"), "available", true)
    ) {
      return true;
    }

    const availableRespondents = respondents
      .filter((respondent) => respondent.availableShiftIds.has(shift.id))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

    for (const respondent of availableRespondents) {
      const sameDayAssignments = (assignmentsByRespondentId.get(respondent.id) ?? []).filter(
        (assignment) => shiftMap.get(assignment.shiftId)?.date === shift.date && assignment.source !== "manual",
      );
      if (sameDayAssignments.length !== 1) continue;

      const conflictingAssignment = sameDayAssignments[0];
      const conflictingShift = shiftMap.get(conflictingAssignment.shiftId);
      if (!conflictingShift) continue;

      const originalAssignment = conflictingAssignment;
      removeAssignment(conflictingShift.id);

      const candidateForBlank =
        candidateFor(shift, respondent, "available", false) ??
        (input.allowAfpOverCapForAvailableShifts
          ? candidateFor(shift, respondent, "available", true)
          : null);

      if (candidateForBlank) {
        addAssignment({
          respondentId: respondent.id,
          shiftId: shift.id,
          source: candidateForBlank.source,
          explanationCodes:
            candidateForBlank.source === "engine_afp_cap_overflow_available"
              ? ["BLOCKED_BY_AFP_CAP"]
              : [],
        });

        const moved = assignBest(
          conflictingShift,
          respondents.filter((candidate) => candidate.id !== respondent.id),
          "available",
          false,
        ) ||
          (input.allowAfpOverCapForAvailableShifts &&
            assignBest(
              conflictingShift,
              respondents.filter((candidate) => candidate.id !== respondent.id && candidate.category === "AFP"),
              "available",
              true,
            ));

        if (moved) return true;
        removeAssignment(shift.id);
      }

      addAssignment(originalAssignment);
    }

    return false;
  };

  for (const shift of availableShiftOrder) {
    if (!assignmentByShiftId.has(shift.id)) repairBlankWithAvailability(shift);
  }

  const fallbackRespondents = respondents.filter(
    (respondent) => respondent.category === "AFP" && respondent.allowNoAvailabilityFallback,
  );
  const noAvailabilityShifts = shifts.filter((shift) => (availabilityByShiftId.get(shift.id)?.size ?? 0) === 0);
  for (const shift of noAvailabilityShifts) {
    if (assignmentByShiftId.has(shift.id)) continue;
    assignBest(shift, fallbackRespondents, "no_availability_fallback", true);
  }

  const plans = respondents.map((respondent) => {
    const assignments = (assignmentsByRespondentId.get(respondent.id) ?? []).sort((a, b) => {
      const shiftA = shiftMap.get(a.shiftId)!;
      const shiftB = shiftMap.get(b.shiftId)!;
      return (
        shiftA.date.localeCompare(shiftB.date) ||
        shiftA.slotIndex - shiftB.slotIndex ||
        shiftA.id - shiftB.id
      );
    });
    const shiftIds = assignments.map((assignment) => assignment.shiftId);
    return {
      respondentId: respondent.id,
      name: respondent.name,
      category: respondent.category,
      shiftIds,
      totalHours: minutesToHours(calcMinutes(shiftIds, shiftMap)),
      isManuallyAdjusted: assignments.some((assignment) => assignment.source === "manual"),
      penaltyNote: null,
    };
  });

  const allHours = plans.map((plan) => plan.totalHours);
  return {
    plans,
    assignments: Array.from(assignmentByShiftId.values()).sort((a, b) => {
      const shiftA = shiftMap.get(a.shiftId)!;
      const shiftB = shiftMap.get(b.shiftId)!;
      return shiftA.date.localeCompare(shiftB.date) || shiftA.slotIndex - shiftB.slotIndex || shiftA.id - shiftB.id;
    }),
    averageHours: allHours.length > 0 ? allHours.reduce((a, b) => a + b, 0) / allHours.length : 0,
    stdDev: stdDev(allHours),
    unallocatedShiftIds: shifts.map((shift) => shift.id).filter((shiftId) => !assignmentByShiftId.has(shiftId)),
  };
}

export async function runAllocation(options: AllocationOptions): Promise<PureAllocationOutput> {
  const [{ db, shiftsTable, respondentsTable, responsesTable }, { eq }] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
  ]);
  const {
    surveyId,
    afpRespondentIds,
    afpUnclaimedShiftRespondentIds,
    includedRespondentIds,
    allowAfpOverCapForAvailableShifts,
    existingManualAssignments,
  } = options;
  const afpIdSet = new Set(afpRespondentIds);
  const afpUnclaimedShiftIdSet = new Set(afpUnclaimedShiftRespondentIds ?? []);
  const includedIdSet = includedRespondentIds?.length ? new Set(includedRespondentIds) : null;

  const shifts = await db.select().from(shiftsTable).where(eq(shiftsTable.surveyId, surveyId));

  const responses = await db
    .select({
      respondentId: responsesTable.respondentId,
      shiftId: responsesTable.shiftId,
      respondentName: respondentsTable.preferredName,
      respondentFullName: respondentsTable.name,
      respondentCategory: respondentsTable.category,
      hasPenalty: responsesTable.hasPenalty,
      penaltyHours: responsesTable.penaltyHours,
      afpHoursCap: responsesTable.afpHoursCap,
    })
    .from(responsesTable)
    .innerJoin(respondentsTable, eq(responsesTable.respondentId, respondentsTable.id))
    .where(eq(responsesTable.surveyId, surveyId));

  const respondentMap = new Map<number, AllocationRespondentInput>();
  for (const response of responses) {
    if (includedIdSet && !includedIdSet.has(response.respondentId)) continue;
    const category = afpIdSet.has(response.respondentId) || response.respondentCategory === "AFP" ? "AFP" : "General";
    const hasPenalty = Boolean(response.hasPenalty);
    const penaltyHours = hasPenalty ? Math.max(0, response.penaltyHours ?? 0) : 0;
    const afpHoursCap = Math.max(0, response.afpHoursCap ?? 10);
    if (!respondentMap.has(response.respondentId)) {
      respondentMap.set(response.respondentId, {
        id: response.respondentId,
        name: safeDisplayName(response.respondentName, response.respondentFullName),
        category,
        availableShiftIds: new Set(),
        hasPenalty,
        penaltyHours,
        afpHoursCap,
        allowNoAvailabilityFallback: afpUnclaimedShiftIdSet.has(response.respondentId),
      });
    }

    const respondent = respondentMap.get(response.respondentId)!;
    respondent.category = category;
    respondent.hasPenalty = respondent.hasPenalty || hasPenalty;
    respondent.penaltyHours = Math.max(respondent.penaltyHours, penaltyHours);
    respondent.afpHoursCap = afpHoursCap;
    respondent.allowNoAvailabilityFallback = afpUnclaimedShiftIdSet.has(response.respondentId);
    respondent.availableShiftIds.add(response.shiftId);
  }

  return runPureAllocation({
    shifts,
    respondents: Array.from(respondentMap.values()),
    allowAfpOverCapForAvailableShifts,
    manualAssignments: existingManualAssignments,
  });
}
