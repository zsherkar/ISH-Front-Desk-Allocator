import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, surveysTable, shiftsTable, respondentsTable, allocationsTable, responsesTable } from "@workspace/db";
import { runAllocation } from "../lib/allocationEngine.js";
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

  const shifts = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.surveyId, surveyId));

  const shiftMap = new Map(shifts.map((s) => [s.id, s]));
  const allShiftIds = new Set(shifts.map((s) => s.id));

  const respondentMap = new Map<
    number,
    {
      respondentId: number;
      name: string;
      category: string;
      shiftIds: number[];
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
        isManuallyAdjusted: a.isManuallyAdjusted,
        penaltyNote: a.penaltyNote ?? null,
      });
    }
    respondentMap.get(a.respondentId)!.shiftIds.push(a.shiftId);
    if (a.isManuallyAdjusted) respondentMap.get(a.respondentId)!.isManuallyAdjusted = true;
  }

  const allocatedShiftIds = new Set(allocations.map((a) => a.shiftId));
  const unallocatedShiftIds = Array.from(allShiftIds).filter((id) => !allocatedShiftIds.has(id));

  const allocationsList = Array.from(respondentMap.values()).map((r) => {
    const totalHours = r.shiftIds.reduce((sum, id) => sum + (shiftMap.get(id)?.durationHours ?? 0), 0);
    const allocatedShifts = r.shiftIds.map((id) => {
      const shift = shiftMap.get(id)!;
      return {
        shiftId: id,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        label: shift.label,
        durationHours: shift.durationHours,
        dayType: shift.dayType as "weekday" | "weekend",
      };
    }).sort((a, b) => `${a.date}-${a.startTime}`.localeCompare(`${b.date}-${b.startTime}`));
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

  const allHours = allocationsList.map((a) => a.totalHours);
  const avg = computeAverage(allHours);
  const std = computeStdDev(allHours, avg);

  return { surveyId, allocations: allocationsList, averageHours: avg, stdDev: std, unallocatedShiftIds };
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

  // Clear existing allocations
  await db.delete(allocationsTable).where(eq(allocationsTable.surveyId, id));

  const result = await runAllocation({
    surveyId: id,
    afpRespondentIds,
    afpUnclaimedShiftRespondentIds,
    includedRespondentIds,
  });

  // Save allocations to DB
  for (const plan of result.plans) {
    for (const shiftId of plan.shiftIds) {
      await db.insert(allocationsTable).values({
        surveyId: id,
        respondentId: plan.respondentId,
        shiftId,
        isManuallyAdjusted: false,
        penaltyNote: null,
      });
    }
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
    respondentStats,
    afpStats,
    generalStats,
    nonPenalizedGeneralStats,
    penalizedStats,
    nonPenalizedGeneralMeanHours,
  });
});

export default router;
