import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, surveysTable, shiftsTable, respondentsTable, responsesTable, allocationsTable } from "@workspace/db";
import { generateShiftsForMonth } from "../lib/shiftGenerator.js";
import {
  CreateSurveyBody,
  UpdateSurveyBody,
  ListSurveysResponse,
  GetSurveyResponse,
  UpdateSurveyResponse,
  GetSurveyStatsResponse,
  GetSurveyResponsesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function shortToken(length = 12): string {
  return Array.from({ length }).map(() => TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)]).join("");
}

router.get("/surveys", async (_req, res): Promise<void> => {
  const now = new Date();
  await db
    .update(surveysTable)
    .set({ status: "closed" })
    .where(and(eq(surveysTable.status, "open"), sql`${surveysTable.closesAt} <= ${now}`));
  const surveys = await db.select().from(surveysTable).orderBy(surveysTable.createdAt);
  res.json(ListSurveysResponse.parse(surveys));
});

router.post("/surveys", async (req, res): Promise<void> => {
  const parsed = CreateSurveyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { month, year, title } = parsed.data;
  const surveyTitle = title || `${MONTH_NAMES[month - 1]} ${year} Shift Survey`;
  const closesAt = req.body?.closesAt ? new Date(req.body.closesAt) : null;
  const token = shortToken(12);

  const [survey] = await db
    .insert(surveysTable)
    .values({ month, year, title: surveyTitle, status: "open", token, closesAt })
    .returning();

  const shiftTemplates = generateShiftsForMonth(year, month);
  if (shiftTemplates.length > 0) {
    await db.insert(shiftsTable).values(
      shiftTemplates.map((s) => ({
        surveyId: survey.id,
        date: s.date,
        dayType: s.dayType,
        startTime: s.startTime,
        endTime: s.endTime,
        durationHours: s.durationHours,
        label: s.label,
      }))
    );
  }

  res.status(201).json(survey);
});

router.get("/surveys/:id", async (req, res): Promise<void> => {
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
  if (survey.status === "open" && survey.closesAt && new Date(survey.closesAt) <= new Date()) {
    await db.update(surveysTable).set({ status: "closed" }).where(eq(surveysTable.id, id));
    survey.status = "closed";
  }

  const shifts = await db.select().from(shiftsTable).where(eq(shiftsTable.surveyId, id));

  const [{ count }] = await db
    .select({ count: sql<number>`count(distinct ${responsesTable.respondentId})` })
    .from(responsesTable)
    .where(eq(responsesTable.surveyId, id));

  res.json({
    ...survey,
    shifts,
    responseCount: Number(count),
  });
});

router.patch("/surveys/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = UpdateSurveyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Partial<typeof surveysTable.$inferInsert> = {};
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.title !== undefined && parsed.data.title !== null) updateData.title = parsed.data.title;
  if (req.body?.closesAt !== undefined) {
    updateData.closesAt = req.body.closesAt ? new Date(req.body.closesAt) : null;
  }
  if (parsed.data.status === "open" && req.body?.closesAt === undefined) {
    const [existingSurvey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
    if (existingSurvey?.closesAt && new Date(existingSurvey.closesAt) <= new Date()) {
      updateData.closesAt = null;
    }
  }

  const [survey] = await db
    .update(surveysTable)
    .set(updateData)
    .where(eq(surveysTable.id, id))
    .returning();

  if (!survey) {
    res.status(404).json({ error: "Survey not found" });
    return;
  }

  res.json(UpdateSurveyResponse.parse(survey));
});

router.delete("/surveys/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [survey] = await db.delete(surveysTable).where(eq(surveysTable.id, id)).returning();
  if (!survey) {
    res.status(404).json({ error: "Survey not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/surveys/:id/responses", async (req, res): Promise<void> => {
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

  const responses = await db
    .select({
      respondentId: responsesTable.respondentId,
      shiftId: responsesTable.shiftId,
      respondentName: respondentsTable.name,
      preferredName: respondentsTable.preferredName,
      respondentCategory: respondentsTable.category,
    })
    .from(responsesTable)
    .innerJoin(respondentsTable, eq(responsesTable.respondentId, respondentsTable.id))
    .where(eq(responsesTable.surveyId, id));

  // Group by respondent
  const respondentMap = new Map<
    number,
    { respondentId: number; name: string; preferredName: string; category: string; selectedShiftIds: number[] }
  >();

  for (const r of responses) {
    if (!respondentMap.has(r.respondentId)) {
        respondentMap.set(r.respondentId, {
          respondentId: r.respondentId,
          name: r.respondentName,
          preferredName: r.preferredName,
          category: r.respondentCategory,
          selectedShiftIds: [],
        });
    }
    respondentMap.get(r.respondentId)!.selectedShiftIds.push(r.shiftId);
  }

  const shifts = await db.select().from(shiftsTable).where(eq(shiftsTable.surveyId, id));
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));

  const result = Array.from(respondentMap.values()).map((r) => ({
    ...r,
    totalAvailableHours: r.selectedShiftIds.reduce((sum, id) => sum + (shiftMap.get(id)?.durationHours ?? 0), 0),
  }));

  res.json(result);
});

router.delete("/surveys/:id/responses/:respondentId", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const respondentId = parseInt(
    Array.isArray(req.params.respondentId) ? req.params.respondentId[0] : req.params.respondentId,
    10,
  );
  if (isNaN(id) || isNaN(respondentId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db.delete(responsesTable).where(and(eq(responsesTable.surveyId, id), eq(responsesTable.respondentId, respondentId)));
  res.sendStatus(204);
});

router.put("/surveys/:id/responses/:respondentId", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const respondentId = parseInt(
    Array.isArray(req.params.respondentId) ? req.params.respondentId[0] : req.params.respondentId,
    10,
  );
  const selectedShiftIds = Array.isArray(req.body?.selectedShiftIds)
    ? req.body.selectedShiftIds.filter((value: unknown): value is number => typeof value === "number")
    : [];
  if (isNaN(id) || isNaN(respondentId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db.delete(responsesTable).where(and(eq(responsesTable.surveyId, id), eq(responsesTable.respondentId, respondentId)));
  for (const shiftId of selectedShiftIds) {
    await db.insert(responsesTable).values({ surveyId: id, respondentId, shiftId });
  }
  res.sendStatus(204);
});

router.get("/surveys/:id/stats", async (req, res): Promise<void> => {
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

  const shifts = await db.select().from(shiftsTable).where(eq(shiftsTable.surveyId, id));
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));

  const responses = await db
    .select({
      respondentId: responsesTable.respondentId,
      shiftId: responsesTable.shiftId,
      respondentName: respondentsTable.name,
      respondentCategory: respondentsTable.category,
    })
    .from(responsesTable)
    .innerJoin(respondentsTable, eq(responsesTable.respondentId, respondentsTable.id))
    .where(eq(responsesTable.surveyId, id));

  const respondentMap = new Map<
    number,
    { respondentId: number; name: string; category: string; shiftIds: number[] }
  >();

  for (const r of responses) {
    if (!respondentMap.has(r.respondentId)) {
      respondentMap.set(r.respondentId, {
        respondentId: r.respondentId,
        name: r.respondentName,
        category: r.respondentCategory,
        shiftIds: [],
      });
    }
    respondentMap.get(r.respondentId)!.shiftIds.push(r.shiftId);
  }

  const allRespondents = Array.from(respondentMap.values());
  const totalRespondents = allRespondents.length;

  const hoursByRespondent = allRespondents.map((r) =>
    r.shiftIds.reduce((sum, id) => sum + (shiftMap.get(id)?.durationHours ?? 0), 0)
  );

  const avgHours = totalRespondents > 0 ? hoursByRespondent.reduce((a, b) => a + b, 0) / totalRespondents : 0;
  const variance =
    totalRespondents > 0
      ? hoursByRespondent.reduce((sum, h) => sum + Math.pow(h - avgHours, 2), 0) / totalRespondents
      : 0;
  const stdDevHours = Math.sqrt(variance);

  // Shift type stats - group by time slot label
  const shiftTypeMap = new Map<string, { label: string; dayType: string; count: number }>();
  for (const r of responses) {
    const shift = shiftMap.get(r.shiftId);
    if (!shift) continue;
    const timeKey = `${shift.dayType}|${shift.startTime}-${shift.endTime}`;
    if (!shiftTypeMap.has(timeKey)) {
      const timeLabel = shift.dayType === "weekday"
        ? `Weekday ${shift.startTime}-${shift.endTime}`
        : `Weekend ${shift.startTime}-${shift.endTime}`;
      shiftTypeMap.set(timeKey, { label: timeLabel, dayType: shift.dayType, count: 0 });
    }
    shiftTypeMap.get(timeKey)!.count++;
  }

  const shiftTypeStats = Array.from(shiftTypeMap.entries()).map(([, v]) => ({
    shiftLabel: v.label,
    dayType: v.dayType as "weekday" | "weekend",
    totalSelections: v.count,
    selectionRate: totalRespondents > 0 ? v.count / totalRespondents : 0,
  }));

  const respondentStats = allRespondents.map((r) => {
    const weekdayShifts = r.shiftIds.filter((id) => shiftMap.get(id)?.dayType === "weekday").length;
    const weekendShifts = r.shiftIds.filter((id) => shiftMap.get(id)?.dayType === "weekend").length;
    const totalAvailableHours = r.shiftIds.reduce((sum, id) => sum + (shiftMap.get(id)?.durationHours ?? 0), 0);
    return {
      respondentId: r.respondentId,
      name: r.name,
      category: r.category as "AFP" | "General",
      totalAvailableHours,
      shiftsSelected: r.shiftIds.length,
      weekdayShifts,
      weekendShifts,
    };
  });

  res.json({
    totalRespondents,
    averageAvailableHours: avgHours,
    stdDevAvailableHours: stdDevHours,
    shiftTypeStats,
    respondentStats,
  });
});

export default router;
