import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, surveysTable, shiftsTable, respondentsTable, allocationsTable, responsesTable } from "@workspace/db";
import { runAllocation } from "../lib/allocationEngine.js";
import {
  RunAllocationBody,
  AdjustAllocationBody,
  RunAllocationResponse,
  GetAllocationsResponse,
  AdjustAllocationResponse,
  GetAllocationStatsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function buildAllocationResult(surveyId: number) {
  const allocations = await db
    .select({
      respondentId: allocationsTable.respondentId,
      shiftId: allocationsTable.shiftId,
      isManuallyAdjusted: allocationsTable.isManuallyAdjusted,
      penaltyNote: allocationsTable.penaltyNote,
      respondentName: respondentsTable.name,
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
        name: a.respondentName,
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
  });

  const allHours = allocationsList.map((a) => a.totalHours);
  const avg = allHours.length > 0 ? allHours.reduce((a, b) => a + b, 0) / allHours.length : 0;
  const variance =
    allHours.length > 0
      ? allHours.reduce((sum, h) => sum + Math.pow(h - avg, 2), 0) / allHours.length
      : 0;
  const std = Math.sqrt(variance);

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

  // Clear existing allocations
  await db.delete(allocationsTable).where(eq(allocationsTable.surveyId, id));

  const result = await runAllocation({
    surveyId: id,
    afpRespondentIds: parsed.data.afpRespondentIds,
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

  const { respondentId, shiftIdsToAdd = [], shiftIdsToRemove = [], penaltyNote } = parsed.data;

  // Remove specified shifts
  if (shiftIdsToRemove.length > 0) {
    await db
      .delete(allocationsTable)
      .where(
        and(
          eq(allocationsTable.surveyId, id),
          eq(allocationsTable.respondentId, respondentId),
          inArray(allocationsTable.shiftId, shiftIdsToRemove)
        )
      );
  }

  // Add specified shifts
  for (const shiftId of shiftIdsToAdd) {
    // Check if already allocated
    const existing = await db
      .select()
      .from(allocationsTable)
      .where(
        and(
          eq(allocationsTable.surveyId, id),
          eq(allocationsTable.respondentId, respondentId),
          eq(allocationsTable.shiftId, shiftId)
        )
      );
    if (existing.length === 0) {
      await db.insert(allocationsTable).values({
        surveyId: id,
        respondentId,
        shiftId,
        isManuallyAdjusted: true,
        penaltyNote: penaltyNote ?? null,
      });
    }
  }

  // Mark respondent's allocations as manually adjusted
  if (penaltyNote !== undefined || shiftIdsToAdd.length > 0 || shiftIdsToRemove.length > 0) {
    await db
      .update(allocationsTable)
      .set({ isManuallyAdjusted: true, penaltyNote: penaltyNote ?? null })
      .where(
        and(
          eq(allocationsTable.surveyId, id),
          eq(allocationsTable.respondentId, respondentId)
        )
      );
  }

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

  const toStat = (a: typeof allocations[0]) => ({
    respondentId: a.respondentId,
    name: a.name,
    category: a.category,
    totalHours: a.totalHours,
    weekdayShifts: a.allocatedShifts.filter((s) => s.dayType === "weekday").length,
    weekendShifts: a.allocatedShifts.filter((s) => s.dayType === "weekend").length,
    shiftCount: a.allocatedShifts.length,
    isManuallyAdjusted: a.isManuallyAdjusted,
  });

  const respondentStats = allocations.map(toStat);
  const afpStats = allocations.filter((a) => a.category === "AFP").map(toStat);
  const generalStats = allocations.filter((a) => a.category === "General").map(toStat);

  const allHours = respondentStats.map((r) => r.totalHours);
  const avg = allHours.length > 0 ? allHours.reduce((a, b) => a + b, 0) / allHours.length : 0;
  const variance = allHours.length > 0 ? allHours.reduce((sum, h) => sum + Math.pow(h - avg, 2), 0) / allHours.length : 0;
  const std = Math.sqrt(variance);
  const minHours = allHours.length > 0 ? Math.min(...allHours) : 0;
  const maxHours = allHours.length > 0 ? Math.max(...allHours) : 0;

  res.json({
    averageHours: avg,
    stdDev: std,
    minHours,
    maxHours,
    respondentStats,
    afpStats,
    generalStats,
  });
});

export default router;
