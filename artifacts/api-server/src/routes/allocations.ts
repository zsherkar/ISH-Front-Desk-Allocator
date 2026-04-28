import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, surveysTable, shiftsTable, respondentsTable, allocationsTable, responsesTable } from "@workspace/db";
import { runAllocation } from "../lib/allocationEngine.js";
import {
  type AssignmentSource,
  type ExplanationCode,
  canAssignShiftToRespondent,
  deriveShiftSlotIndexes,
  hoursToMinutes,
  isBackToBack,
  sameDayAllocationTier,
  stableShiftKey,
} from "../lib/allocationCore.js";
import { computeAverage, computeMedian, computeStdDev } from "../lib/stats.js";
import {
  RunAllocationBody,
  AdjustAllocationBody,
} from "@workspace/api-zod";
import {
  dedupePositiveIntegerIds,
  FIELD_LIMITS,
  normalizeOptionalText,
  safeDisplayName,
} from "../lib/inputValidation.js";

const router: IRouter = Router();

async function buildAllocationResult(surveyId: number) {
  const allocations = await db
    .select({
      respondentId: allocationsTable.respondentId,
      shiftId: allocationsTable.shiftId,
      isManuallyAdjusted: allocationsTable.isManuallyAdjusted,
      penaltyNote: allocationsTable.penaltyNote,
      respondentName: respondentsTable.preferredName,
      respondentFullName: respondentsTable.name,
      respondentCategory: respondentsTable.category,
    })
    .from(allocationsTable)
    .innerJoin(respondentsTable, eq(allocationsTable.respondentId, respondentsTable.id))
    .where(eq(allocationsTable.surveyId, surveyId));

  const rawShifts = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.surveyId, surveyId));

  const slotIndexes = deriveShiftSlotIndexes(rawShifts);
  const shifts = rawShifts.map((shift) => {
    const slotIndex = slotIndexes.get(shift.id) ?? 0;
    return {
      ...shift,
      slotIndex,
      stableShiftKey: stableShiftKey({ ...shift, slotIndex }),
    };
  });
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));
  const allShiftIds = new Set(shifts.map((s) => s.id));
  const responseRows = await db
    .select({
      shiftId: responsesTable.shiftId,
      respondentId: responsesTable.respondentId,
      respondentName: respondentsTable.preferredName,
      respondentFullName: respondentsTable.name,
      respondentEmail: respondentsTable.email,
      respondentCategory: respondentsTable.category,
      hasPenalty: responsesTable.hasPenalty,
      penaltyHours: responsesTable.penaltyHours,
      afpHoursCap: responsesTable.afpHoursCap,
    })
    .from(responsesTable)
    .innerJoin(respondentsTable, eq(responsesTable.respondentId, respondentsTable.id))
    .where(eq(responsesTable.surveyId, surveyId));
  const availableRespondentsByShiftId = new Map<
    number,
    {
      respondentId: number;
      name: string;
      email: string | null;
      category: string;
      hasPenalty: boolean;
      penaltyHours: number;
      afpHoursCap: number;
    }[]
  >();
  const respondentSettingsById = new Map<
    number,
    {
      respondentId: number;
      name: string;
      email: string | null;
      category: string;
      hasPenalty: boolean;
      penaltyHours: number;
      afpHoursCap: number;
      availableShiftIds: Set<number>;
    }
  >();
  for (const row of responseRows) {
    const respondents = availableRespondentsByShiftId.get(row.shiftId) ?? [];
    const respondentName = safeDisplayName(row.respondentName, row.respondentFullName);
    respondents.push({
      respondentId: row.respondentId,
      name: respondentName,
      email: row.respondentEmail,
      category: row.respondentCategory,
      hasPenalty: Boolean(row.hasPenalty),
      penaltyHours: row.hasPenalty ? row.penaltyHours ?? 0 : 0,
      afpHoursCap: row.afpHoursCap ?? 10,
    });
    availableRespondentsByShiftId.set(row.shiftId, respondents);

    if (!respondentSettingsById.has(row.respondentId)) {
      respondentSettingsById.set(row.respondentId, {
        respondentId: row.respondentId,
        name: respondentName,
        email: row.respondentEmail,
        category: row.respondentCategory,
        hasPenalty: Boolean(row.hasPenalty),
        penaltyHours: row.hasPenalty ? row.penaltyHours ?? 0 : 0,
        afpHoursCap: row.afpHoursCap ?? 10,
        availableShiftIds: new Set(),
      });
    }
    const setting = respondentSettingsById.get(row.respondentId)!;
    setting.category = row.respondentCategory;
    setting.hasPenalty = setting.hasPenalty || Boolean(row.hasPenalty);
    setting.penaltyHours = Math.max(setting.penaltyHours, row.hasPenalty ? row.penaltyHours ?? 0 : 0);
    setting.afpHoursCap = Math.max(0, row.afpHoursCap ?? setting.afpHoursCap);
    setting.availableShiftIds.add(row.shiftId);
  }

  const respondentMap = new Map<
    number,
    {
      respondentId: number;
      name: string;
      category: string;
      shiftIds: number[];
      manualShiftIds: Set<number>;
      isManuallyAdjusted: boolean;
      penaltyNote: string | null;
    }
  >();

  for (const a of allocations) {
    if (!respondentMap.has(a.respondentId)) {
      respondentMap.set(a.respondentId, {
        respondentId: a.respondentId,
        name: safeDisplayName(a.respondentName, a.respondentFullName),
        category: a.respondentCategory,
        shiftIds: [],
        manualShiftIds: new Set(),
        isManuallyAdjusted: a.isManuallyAdjusted,
        penaltyNote: a.penaltyNote ?? null,
      });
    }
    respondentMap.get(a.respondentId)!.shiftIds.push(a.shiftId);
    if (a.isManuallyAdjusted) {
      respondentMap.get(a.respondentId)!.isManuallyAdjusted = true;
      respondentMap.get(a.respondentId)!.manualShiftIds.add(a.shiftId);
    }
  }

  const allocatedShiftIds = new Set(allocations.map((a) => a.shiftId));
  const unallocatedShiftIds = Array.from(allShiftIds).filter((id) => !allocatedShiftIds.has(id));
  const allocationShiftIdsByRespondentId = new Map<number, number[]>();
  const manualShiftIds = new Set<number>();
  for (const respondent of respondentMap.values()) {
    allocationShiftIdsByRespondentId.set(respondent.respondentId, respondent.shiftIds);
    for (const shiftId of respondent.manualShiftIds) manualShiftIds.add(shiftId);
  }

  const allocationsList = Array.from(respondentMap.values()).map((r) => {
    const totalHours = r.shiftIds.reduce((sum, id) => sum + (shiftMap.get(id)?.durationHours ?? 0), 0);
    let afpNormalMinutes = 0;
    const allocatedShifts = [...r.shiftIds].sort((a, b) => {
      const shiftA = shiftMap.get(a)!;
      const shiftB = shiftMap.get(b)!;
      return shiftA.date.localeCompare(shiftB.date) || shiftA.slotIndex - shiftB.slotIndex || shiftA.id - shiftB.id;
    }).map((id) => {
      const shift = shiftMap.get(id)!;
      const availabilityCount = availableRespondentsByShiftId.get(id)?.length ?? 0;
      const hasBackToBackPair = r.shiftIds.some((otherId) => otherId !== id && isBackToBack(shift, shiftMap.get(otherId)!));
      const capHours = respondentSettingsById.get(r.respondentId)?.afpHoursCap ?? 10;
      let assignmentSource: AssignmentSource;
      if (r.manualShiftIds.has(id)) {
        assignmentSource = "manual";
      } else if (availabilityCount === 0 && r.category === "AFP") {
        assignmentSource = "engine_no_availability_afp_fallback";
      } else if (
        r.category === "AFP" &&
        afpNormalMinutes + hoursToMinutes(shift.durationHours) > hoursToMinutes(capHours)
      ) {
        assignmentSource = "engine_afp_cap_overflow_available";
      } else {
        assignmentSource = hasBackToBackPair ? "engine_back_to_back_emergency" : "engine_normal";
      }
      if (
        r.category === "AFP" &&
        (assignmentSource === "engine_normal" || assignmentSource === "engine_back_to_back_emergency")
      ) {
        afpNormalMinutes += hoursToMinutes(shift.durationHours);
      }
      const explanationCodes: ExplanationCode[] = assignmentSource === "manual"
        ? ["MANUAL_OVERRIDE"]
        : assignmentSource === "engine_no_availability_afp_fallback"
          ? ["NO_AVAILABILITY"]
          : assignmentSource === "engine_afp_cap_overflow_available"
            ? ["BLOCKED_BY_AFP_CAP"]
            : [];
      return {
        shiftId: id,
        stableShiftKey: shift.stableShiftKey,
        slotIndex: shift.slotIndex,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        label: shift.label,
        durationHours: shift.durationHours,
        dayType: shift.dayType as "weekday" | "weekend",
        assignmentSource,
        isManual: assignmentSource === "manual",
        isEmergency: hasBackToBackPair,
        explanationCodes,
      };
    });
    return {
      respondentId: r.respondentId,
      name: r.name,
      category: r.category as "AFP" | "General",
      allocatedShifts,
      totalHours,
      isManuallyAdjusted: r.isManuallyAdjusted,
      penaltyNote: r.penaltyNote,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const allocatedShiftById = new Map(
    allocationsList.flatMap((allocation) =>
      allocation.allocatedShifts.map((shift) => [shift.shiftId, { ...shift, respondentId: allocation.respondentId, respondentName: allocation.name }] as const),
    ),
  );
  const renderedStartTimes = {
    weekday: new Set(["09:00", "11:00", "14:00", "17:00"]),
    weekend: new Set(["08:00", "12:00", "16:00"]),
  };
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const allocationAudit = shifts.map((shift) => {
    const assigned = allocatedShiftById.get(shift.id);
    const availableRespondents = availableRespondentsByShiftId.get(shift.id) ?? [];
    const isRenderedSlot =
      shift.dayType === "weekend"
        ? renderedStartTimes.weekend.has(shift.startTime)
        : renderedStartTimes.weekday.has(shift.startTime);
    const availableWithDiagnostics = availableRespondents.map((respondent) => {
      const existingShiftIds = (allocationShiftIdsByRespondentId.get(respondent.respondentId) ?? []).filter(
        (existingShiftId) => existingShiftId !== shift.id,
      );
      const sameDayAssignedShiftIds = existingShiftIds.filter((id) => shiftMap.get(id)?.date === shift.date);
      const alreadyAssignedMinutes = existingShiftIds.reduce(
        (sum, id) => sum + hoursToMinutes(shiftMap.get(id)?.durationHours ?? 0),
        0,
      );
      const currentNormalMinutes = existingShiftIds
        .filter((id) => !manualShiftIds.has(id) && (availableRespondentsByShiftId.get(id)?.length ?? 0) > 0)
        .reduce((sum, id) => sum + hoursToMinutes(shiftMap.get(id)?.durationHours ?? 0), 0);
      const baseSource = sameDayAllocationTier(shift.id, existingShiftIds, shiftMap) === 1
        ? "engine_back_to_back_emergency"
        : "engine_normal";
      const validation = canAssignShiftToRespondent({
        shiftId: shift.id,
        existingShiftIds,
        shiftMap,
        isAvailable: true,
        assignmentSource: baseSource,
        category: respondent.category as "AFP" | "General",
        currentNormalMinutes,
        afpCapMinutes: hoursToMinutes(respondent.afpHoursCap),
      });
      const canTakeNormally = validation.ok && !validation.wouldBeBackToBackEmergency;
      const canTakeBackToBackEmergency = validation.ok && validation.wouldBeBackToBackEmergency;
      return {
        respondentId: respondent.respondentId,
        name: respondent.name,
        category: respondent.category as "AFP" | "General",
        penaltyHours: respondent.penaltyHours,
        afpCapHours: respondent.afpHoursCap,
        alreadyAssignedMinutes,
        sameDayAssignedShiftIds,
        canTakeNormally,
        canTakeBackToBackEmergency,
        blockers: validation.ok ? [] : validation.reasonCodes,
      };
    });

    const eligibleNormalCandidateCount = availableWithDiagnostics.filter((respondent) => respondent.canTakeNormally).length;
    const eligibleBackToBackEmergencyCandidateCount = availableWithDiagnostics.filter((respondent) => respondent.canTakeBackToBackEmergency).length;
    const eligibleNoAvailabilityFallbackAfpCount =
      availableRespondents.length === 0
        ? Array.from(respondentSettingsById.values()).filter((respondent) => respondent.category === "AFP").length
        : 0;
    const renderedCellIsBlank = assigned ? !isRenderedSlot : true;
    let reasonCategory = assigned
      ? renderedCellIsBlank
        ? "RENDERING_ASSIGNMENT_MISMATCH"
        : "ASSIGNED"
      : availableRespondents.length === 0
        ? "NO_AVAILABILITY"
        : eligibleNormalCandidateCount + eligibleBackToBackEmergencyCandidateCount > 0
          ? "ENGINE_REPAIR_LIMIT_REACHED"
          : availableWithDiagnostics.every((respondent) => respondent.blockers.includes("BLOCKED_BY_AFP_CAP"))
            ? "BLOCKED_ONLY_BY_AFP_CAP"
            : "ALL_AVAILABLE_BLOCKED_BY_MIXED_CONSTRAINTS";
    if (!assigned && availableRespondents.length === 0 && eligibleNoAvailabilityFallbackAfpCount === 0) {
      reasonCategory = "NO_FALLBACK_AFP_SELECTED";
    }

    return {
      shiftId: shift.id,
      stableShiftKey: shift.stableShiftKey,
      date: shift.date,
      dayOfWeek: dayNames[new Date(`${shift.date}T00:00:00Z`).getUTCDay()] ?? "",
      startTime: shift.startTime,
      endTime: shift.endTime,
      slotIndex: shift.slotIndex,
      durationMinutes: hoursToMinutes(shift.durationHours),
      renderedCellIsBlank,
      allocationRecordExists: Boolean(assigned),
      assignedRespondentId: assigned ? String(assigned.respondentId) : null,
      assignedRespondentName: assigned?.respondentName ?? null,
      assignmentSource: assigned?.assignmentSource ?? null,
      availabilityCount: availableRespondents.length,
      availableRespondents: availableWithDiagnostics,
      eligibleNormalCandidateCount,
      eligibleBackToBackEmergencyCandidateCount,
      eligibleNoAvailabilityFallbackAfpCount,
      reasonCategory,
      explanationText: assigned
        ? renderedCellIsBlank
          ? "An allocation record exists, but the schedule renderer does not have a matching visible date/time cell."
          : "This shift is assigned and should render in the schedule."
        : availableRespondents.length === 0
          ? "No respondent selected availability for this shift."
          : eligibleNormalCandidateCount + eligibleBackToBackEmergencyCandidateCount > 0
            ? "This blank still has a legal available candidate and should be treated as an engine repair bug."
            : "Every available respondent is blocked by hard same-day or AFP cap constraints.",
    };
  });

  const blankShiftExplanations = unallocatedShiftIds.map((shiftId) => {
    const shift = shiftMap.get(shiftId)!;
    const auditRow = allocationAudit.find((row) => row.shiftId === shiftId)!;
    const reasonCategory =
      auditRow.reasonCategory === "NO_FALLBACK_AFP_SELECTED"
        ? "NO_FALLBACK_AFP_SELECTED"
        : auditRow.reasonCategory === "NO_AVAILABILITY"
          ? "NO_AVAILABILITY"
          : auditRow.reasonCategory === "BLOCKED_ONLY_BY_AFP_CAP"
            ? "ALL_AVAILABLE_BLOCKED_BY_AFP_CAP"
            : auditRow.availableRespondents.every((respondent) =>
                respondent.blockers.some((blocker) =>
                  blocker === "BLOCKED_BY_MAX_TWO_SHIFTS_DAY" || blocker === "BLOCKED_BY_NON_ADJACENT_SAME_DAY",
                ),
              )
              ? "ALL_AVAILABLE_BLOCKED_BY_SAME_DAY"
              : "ALL_AVAILABLE_BLOCKED_BY_MIXED_CONSTRAINTS";

    return {
      shiftId,
      stableShiftKey: shift.stableShiftKey,
      slotIndex: shift.slotIndex,
      date: shift.date,
      label: shift.label,
      startTime: shift.startTime,
      endTime: shift.endTime,
      durationHours: shift.durationHours,
      availabilityCount: auditRow.availabilityCount,
      availableRespondents: auditRow.availableRespondents.map((respondent) => ({
        respondentId: respondent.respondentId,
        name: respondent.name,
        category: respondent.category,
        blockers: respondent.blockers.length > 0 ? respondent.blockers : ["ENGINE_REPAIR_LIMIT_REACHED"],
      })),
      reasonCategory,
      explanationCodes:
        auditRow.availabilityCount === 0
          ? ["NO_AVAILABILITY", "NO_FALLBACK_AFP_SELECTED"] as ExplanationCode[]
          : Array.from(new Set(auditRow.availableRespondents.flatMap((respondent) => respondent.blockers.length > 0 ? respondent.blockers : ["ENGINE_REPAIR_LIMIT_REACHED"]))),
      explanationText: auditRow.explanationText,
    };
  });

  const allHours = allocationsList.map((a) => a.totalHours);
  const avg = computeAverage(allHours);
  const std = computeStdDev(allHours, avg);

  return {
    surveyId,
    allocations: allocationsList,
    averageHours: avg,
    stdDev: std,
    unallocatedShiftIds,
    blankShiftExplanations,
    allocationAudit,
  };
}

router.post("/surveys/:id/allocate", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) {
    res.status(404).json({ error: "Survey not found" });
    return;
  }

  if (survey.status !== "closed") {
    res.status(400).json({ error: "Survey must be closed before running allocation" });
    return;
  }

  const parsed = RunAllocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const surveyRespondents = await db
    .select({ respondentId: responsesTable.respondentId })
    .from(responsesTable)
    .where(eq(responsesTable.surveyId, id));
  const surveyRespondentIdSet = new Set(
    surveyRespondents.map((entry) => entry.respondentId),
  );
  const includedRespondentIds = dedupePositiveIntegerIds(
    parsed.data.includedRespondentIds,
  );
  const afpRespondentIds = dedupePositiveIntegerIds(parsed.data.afpRespondentIds);
  const afpUnclaimedShiftRespondentIds = dedupePositiveIntegerIds(
    parsed.data.afpUnclaimedShiftRespondentIds,
  );

  const invalidIncludedRespondentIds = includedRespondentIds.filter(
    (respondentId) => !surveyRespondentIdSet.has(respondentId),
  );
  if (invalidIncludedRespondentIds.length > 0) {
    res.status(400).json({ error: "Included respondents must belong to this survey." });
    return;
  }

  const invalidAfpRespondentIds = afpRespondentIds.filter(
    (respondentId) => !surveyRespondentIdSet.has(respondentId),
  );
  if (invalidAfpRespondentIds.length > 0) {
    res.status(400).json({ error: "AFP respondents must belong to this survey." });
    return;
  }

  if (
    includedRespondentIds.length > 0 &&
    afpRespondentIds.some((respondentId) => !includedRespondentIds.includes(respondentId))
  ) {
    res.status(400).json({ error: "AFP respondents must also be included in this allocation run." });
    return;
  }

  if (
    afpUnclaimedShiftRespondentIds.some((respondentId) => !afpRespondentIds.includes(respondentId))
  ) {
    res.status(400).json({ error: "No-availability fallback respondents must be selected AFP respondents." });
    return;
  }

  if (includedRespondentIds?.length) {
    await db
      .update(respondentsTable)
      .set({ category: "General" })
      .where(inArray(respondentsTable.id, includedRespondentIds));
  }

  if (afpRespondentIds.length > 0) {
    await db
      .update(respondentsTable)
      .set({ category: "AFP" })
      .where(inArray(respondentsTable.id, afpRespondentIds));
  }

  const preserveManualLocks = parsed.data.preserveManualLocks !== false;
  const existingManualAssignments = preserveManualLocks
    ? await db
        .select({
          respondentId: allocationsTable.respondentId,
          shiftId: allocationsTable.shiftId,
        })
        .from(allocationsTable)
        .where(and(eq(allocationsTable.surveyId, id), eq(allocationsTable.isManuallyAdjusted, true)))
    : [];

  if (preserveManualLocks) {
    await db
      .delete(allocationsTable)
      .where(and(eq(allocationsTable.surveyId, id), eq(allocationsTable.isManuallyAdjusted, false)));
  } else {
    await db.delete(allocationsTable).where(eq(allocationsTable.surveyId, id));
  }

  const result = await runAllocation({
    surveyId: id,
    afpRespondentIds,
    afpUnclaimedShiftRespondentIds,
    includedRespondentIds,
    allowAfpOverCapForAvailableShifts: parsed.data.allowAfpOverCapForAvailableShifts ?? false,
    existingManualAssignments,
  });

  // Save allocations to DB
  for (const assignment of result.assignments) {
    if (assignment.source === "manual") continue;
    await db.insert(allocationsTable).values({
      surveyId: id,
      respondentId: assignment.respondentId,
      shiftId: assignment.shiftId,
      isManuallyAdjusted: false,
      penaltyNote: null,
    });
  }

  const allocationResult = await buildAllocationResult(id);
  res.json(allocationResult);
});

router.get("/surveys/:id/allocations", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) {
    res.status(404).json({ error: "Survey not found" });
    return;
  }

  const allocationResult = await buildAllocationResult(id);
  res.json(allocationResult);
});

router.patch("/surveys/:id/allocations/adjust", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) {
    res.status(404).json({ error: "Survey not found" });
    return;
  }

  const parsed = AdjustAllocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const shiftIdsToAdd = dedupePositiveIntegerIds(parsed.data.shiftIdsToAdd);
  const shiftIdsToRemove = dedupePositiveIntegerIds(parsed.data.shiftIdsToRemove);
  const penaltyNoteResult = normalizeOptionalText(
    parsed.data.penaltyNote,
    "Penalty note",
    FIELD_LIMITS.penaltyNote,
  );
  if (!penaltyNoteResult.ok) {
    res.status(400).json({ error: penaltyNoteResult.error });
    return;
  }

  const { respondentId } = parsed.data;
  const [respondent] = await db
    .select({ id: respondentsTable.id })
    .from(respondentsTable)
    .where(eq(respondentsTable.id, respondentId))
    .limit(1);
  if (!respondent) {
    res.status(404).json({ error: "Respondent not found" });
    return;
  }

  const surveyShiftRows = await db
    .select({ id: shiftsTable.id })
    .from(shiftsTable)
    .where(eq(shiftsTable.surveyId, id));
  const surveyShiftIdSet = new Set(surveyShiftRows.map((shift) => shift.id));
  const invalidShiftIds = [...shiftIdsToAdd, ...shiftIdsToRemove].filter(
    (shiftId) => !surveyShiftIdSet.has(shiftId),
  );
  if (invalidShiftIds.length > 0) {
    res.status(400).json({ error: "Shift adjustments must belong to this survey." });
    return;
  }

  await db.transaction(async (tx) => {
    if (shiftIdsToRemove.length > 0) {
      await tx
        .delete(allocationsTable)
        .where(
          and(
            eq(allocationsTable.surveyId, id),
            eq(allocationsTable.respondentId, respondentId),
            inArray(allocationsTable.shiftId, shiftIdsToRemove),
          ),
        );
    }

    for (const shiftId of shiftIdsToAdd) {
      await tx
        .delete(allocationsTable)
        .where(
          and(
            eq(allocationsTable.surveyId, id),
            eq(allocationsTable.shiftId, shiftId),
          ),
        );

      const existingForTarget = await tx
        .select()
        .from(allocationsTable)
        .where(
          and(
            eq(allocationsTable.surveyId, id),
            eq(allocationsTable.respondentId, respondentId),
            eq(allocationsTable.shiftId, shiftId),
          ),
        )
        .limit(1);
      if (existingForTarget.length === 0) {
        await tx.insert(allocationsTable).values({
          surveyId: id,
          respondentId,
          shiftId,
          isManuallyAdjusted: true,
          penaltyNote: penaltyNoteResult.value,
        });
      }
    }

    if (
      parsed.data.penaltyNote !== undefined ||
      shiftIdsToAdd.length > 0 ||
      shiftIdsToRemove.length > 0
    ) {
      await tx
        .update(allocationsTable)
        .set({ isManuallyAdjusted: true, penaltyNote: penaltyNoteResult.value })
        .where(
          and(
            eq(allocationsTable.surveyId, id),
            eq(allocationsTable.respondentId, respondentId),
          ),
        );
    }
  });

  const allocationResult = await buildAllocationResult(id);
  res.json(allocationResult);
});

router.get("/surveys/:id/allocation-stats", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) {
    res.status(404).json({ error: "Survey not found" });
    return;
  }

  const allocationResult = await buildAllocationResult(id);
  const { allocations } = allocationResult;
  const allAllocatedShifts = allocations.flatMap((allocation) =>
    allocation.allocatedShifts.map((shift) => ({ ...shift, respondentId: allocation.respondentId })),
  );
  const manualAssignmentCount = allAllocatedShifts.filter((shift) => shift.isManual).length;
  const backToBackEmergencyCount = allAllocatedShifts.filter(
    (shift) => shift.assignmentSource === "engine_back_to_back_emergency",
  ).length;
  const noAvailabilityFallbackCount = allAllocatedShifts.filter(
    (shift) => shift.assignmentSource === "engine_no_availability_afp_fallback",
  ).length;
  const afpCapOverflowCount = allAllocatedShifts.filter(
    (shift) => shift.assignmentSource === "engine_afp_cap_overflow_available",
  ).length;
  let nonAdjacentSameDayDoubleCount = 0;
  let tripleShiftDayCount = 0;
  for (const allocation of allocations) {
    const byDate = new Map<string, typeof allocation.allocatedShifts>();
    for (const shift of allocation.allocatedShifts) {
      byDate.set(shift.date, [...(byDate.get(shift.date) ?? []), shift]);
    }
    for (const shiftsForDay of byDate.values()) {
      if (shiftsForDay.length >= 3) tripleShiftDayCount += 1;
      if (
        shiftsForDay.length === 2 &&
        !isBackToBack(shiftsForDay[0], shiftsForDay[1])
      ) {
        nonAdjacentSameDayDoubleCount += 1;
      }
    }
  }
  const responseSettings = await db
    .select({
      respondentId: responsesTable.respondentId,
      hasPenalty: responsesTable.hasPenalty,
      penaltyHours: responsesTable.penaltyHours,
    })
    .from(responsesTable)
    .where(eq(responsesTable.surveyId, id));
  const penaltyByRespondentId = new Map<number, { hasPenalty: boolean; penaltyHours: number }>();
  for (const response of responseSettings) {
    const current = penaltyByRespondentId.get(response.respondentId) ?? {
      hasPenalty: false,
      penaltyHours: 0,
    };
    penaltyByRespondentId.set(response.respondentId, {
      hasPenalty: current.hasPenalty || Boolean(response.hasPenalty),
      penaltyHours: Math.max(current.penaltyHours, response.hasPenalty ? response.penaltyHours ?? 0 : 0),
    });
  }

  const toStat = (a: typeof allocations[0]) => {
    const penalty = penaltyByRespondentId.get(a.respondentId) ?? { hasPenalty: false, penaltyHours: 0 };
    return {
      respondentId: a.respondentId,
      name: a.name,
      category: a.category,
      totalHours: a.totalHours,
      weekdayShifts: a.allocatedShifts.filter((s) => s.dayType === "weekday").length,
      weekendShifts: a.allocatedShifts.filter((s) => s.dayType === "weekend").length,
      shiftCount: a.allocatedShifts.length,
      isManuallyAdjusted: a.isManuallyAdjusted,
      hasPenalty: penalty.hasPenalty,
      penaltyHours: penalty.penaltyHours,
      penaltyGapHours: 0,
    };
  };

  const baseRespondentStats = allocations.map(toStat);
  const nonPenalizedGeneralMeanHours = computeAverage(
    baseRespondentStats
      .filter((stat) => stat.category === "General" && !stat.hasPenalty)
      .map((stat) => stat.totalHours),
  );
  const respondentStats = baseRespondentStats.map((stat) => ({
    ...stat,
    penaltyGapHours: stat.hasPenalty ? nonPenalizedGeneralMeanHours - stat.totalHours : 0,
  }));
  const afpStats = respondentStats.filter((a) => a.category === "AFP");
  const generalStats = respondentStats.filter((a) => a.category === "General");
  const nonPenalizedGeneralStats = generalStats.filter((a) => !a.hasPenalty);
  const penalizedStats = generalStats.filter((a) => a.hasPenalty);

  const allHours = respondentStats.map((r) => r.totalHours);
  const avg = computeAverage(allHours);
  const median = computeMedian(allHours);
  const std = computeStdDev(allHours, avg);
  const minHours = allHours.length > 0 ? Math.min(...allHours) : 0;
  const maxHours = allHours.length > 0 ? Math.max(...allHours) : 0;
  const totalAllocatedHours = allHours.reduce((sum, hours) => sum + hours, 0);

  res.json({
    meanHours: avg,
    averageHours: avg,
    medianHours: median,
    stdDev: std,
    minHours,
    maxHours,
    totalAllocatedHours,
    blankShiftCount: allocationResult.blankShiftExplanations.length,
    blankWithAvailabilityCount: allocationResult.blankShiftExplanations.filter(
      (shift) => shift.availabilityCount > 0,
    ).length,
    noAvailabilityBlankCount: allocationResult.blankShiftExplanations.filter(
      (shift) => shift.availabilityCount === 0,
    ).length,
    manualAssignmentCount,
    backToBackEmergencyCount,
    noAvailabilityFallbackCount,
    afpCapOverflowCount,
    nonAdjacentSameDayDoubleCount,
    tripleShiftDayCount,
    renderedBlankButAssignedCount: allocationResult.allocationAudit.filter(
      (row) => row.allocationRecordExists && row.renderedCellIsBlank,
    ).length,
    availabilityMappingFailureCount: allocationResult.allocationAudit.filter(
      (row) => row.reasonCategory === "AVAILABILITY_SHIFT_KEY_MISMATCH",
    ).length,
    respondentStats,
    afpStats,
    generalStats,
    nonPenalizedGeneralStats,
    penalizedStats,
    nonPenalizedGeneralMeanHours,
  });
});

export default router;
