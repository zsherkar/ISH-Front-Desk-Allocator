import { Router, type IRouter } from "express";
import { eq, ilike, or } from "drizzle-orm";
import { db, respondentsTable, allocationsTable, surveysTable, shiftsTable } from "@workspace/db";
import {
  CreateRespondentBody,
  UpdateRespondentBody,
  ListRespondentsResponse,
  UpdateRespondentResponse,
} from "@workspace/api-zod";
import { computeAverage, computeMedian, computeStdDev } from "../lib/stats.js";
import { requireAdmin } from "../lib/adminAuth.js";
import { requireSameOriginForBrowser } from "../lib/security.js";
import {
  FIELD_LIMITS,
  firstGivenName,
  normalizeEmail,
  normalizeRequiredText,
  sanitizePreferredName,
} from "../lib/inputValidation.js";

const router: IRouter = Router();

router.use(requireAdmin, requireSameOriginForBrowser);

function formatTime12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

router.get("/respondents", async (_req, res): Promise<void> => {
  const respondents = await db
    .select()
    .from(respondentsTable)
    .orderBy(respondentsTable.createdAt);
  res.json(ListRespondentsResponse.parse(respondents));
});

router.get("/respondents/lookup", async (req, res): Promise<void> => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 1) {
    res.json([]);
    return;
  }
  const respondents = await db
    .select()
    .from(respondentsTable)
    .where(
      or(
        ilike(respondentsTable.name, `%${query}%`),
        ilike(respondentsTable.preferredName, `%${query}%`),
        ilike(respondentsTable.email, `%${query}%`)
      )
    )
    .limit(8);
  res.json(
    respondents.map((respondent) => ({
      id: respondent.id,
      name: respondent.name,
      email: respondent.email,
      preferredName: respondent.preferredName,
      category: respondent.category,
    })),
  );
});

router.post("/respondents", async (req, res): Promise<void> => {
  const parsed = CreateRespondentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const nameResult = normalizeRequiredText(
    parsed.data.name,
    "Name",
    FIELD_LIMITS.respondentName,
  );
  if (!nameResult.ok) {
    res.status(400).json({ error: nameResult.error });
    return;
  }

  const preferredNameInput =
    typeof req.body?.preferredName === "string"
      ? req.body.preferredName
      : firstGivenName(nameResult.value);
  const preferredNameResult = normalizeRequiredText(
    preferredNameInput,
    "Preferred name",
    FIELD_LIMITS.preferredName,
  );
  if (!preferredNameResult.ok) {
    res.status(400).json({ error: preferredNameResult.error });
    return;
  }

  const emailResult = normalizeEmail(parsed.data.email, { required: false });
  if (!emailResult.ok) {
    res.status(400).json({ error: emailResult.error });
    return;
  }

  if (emailResult.value) {
    const existingRespondent = await db
      .select({ id: respondentsTable.id })
      .from(respondentsTable)
      .where(eq(respondentsTable.email, emailResult.value))
      .limit(1);

    if (existingRespondent[0]) {
      res.status(409).json({ error: "A respondent with that email already exists." });
      return;
    }
  }

  const [respondent] = await db
    .insert(respondentsTable)
    .values({
      name: nameResult.value,
      preferredName: sanitizePreferredName(preferredNameResult.value, nameResult.value),
      email: emailResult.value,
      category: parsed.data.category,
    })
    .returning();

  res.status(201).json(respondent);
});

router.patch("/respondents/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = UpdateRespondentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [currentRespondent] = await db
    .select()
    .from(respondentsTable)
    .where(eq(respondentsTable.id, id))
    .limit(1);
  if (!currentRespondent) {
    res.status(404).json({ error: "Respondent not found" });
    return;
  }

  const updateData: Partial<typeof respondentsTable.$inferInsert> = {};
  if (parsed.data.name !== null && parsed.data.name !== undefined) {
    const nameResult = normalizeRequiredText(
      parsed.data.name,
      "Name",
      FIELD_LIMITS.respondentName,
    );
    if (!nameResult.ok) {
      res.status(400).json({ error: nameResult.error });
      return;
    }
    updateData.name = nameResult.value;
  }

  if (parsed.data.email !== undefined) {
    const emailResult = normalizeEmail(parsed.data.email, { required: false });
    if (!emailResult.ok) {
      res.status(400).json({ error: emailResult.error });
      return;
    }

    if (emailResult.value) {
      const existingRespondent = await db
        .select({ id: respondentsTable.id })
        .from(respondentsTable)
        .where(eq(respondentsTable.email, emailResult.value))
        .limit(1);

      if (existingRespondent[0] && existingRespondent[0].id !== id) {
        res.status(409).json({ error: "A respondent with that email already exists." });
        return;
      }
    }

    updateData.email = emailResult.value;
  }

  if (parsed.data.category !== null && parsed.data.category !== undefined) updateData.category = parsed.data.category;
  if (req.body?.preferredName !== undefined) {
    const fallbackPreferredName = firstGivenName(updateData.name ?? currentRespondent.name);
    const preferredNameInput =
      typeof req.body.preferredName === "string" && req.body.preferredName.trim()
        ? req.body.preferredName
        : fallbackPreferredName;
    const preferredNameResult = normalizeRequiredText(
      preferredNameInput,
      "Preferred name",
      FIELD_LIMITS.preferredName,
    );
    if (!preferredNameResult.ok) {
      res.status(400).json({ error: preferredNameResult.error });
      return;
    }
    updateData.preferredName = sanitizePreferredName(
      preferredNameResult.value,
      updateData.name ?? currentRespondent.name,
    );
  }

  const [respondent] = await db
    .update(respondentsTable)
    .set(updateData)
    .where(eq(respondentsTable.id, id))
    .returning();

  if (!respondent) {
    res.status(404).json({ error: "Respondent not found" });
    return;
  }

  res.json(UpdateRespondentResponse.parse(respondent));
});

router.delete("/respondents/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [respondent] = await db
    .delete(respondentsTable)
    .where(eq(respondentsTable.id, id))
    .returning();

  if (!respondent) {
    res.status(404).json({ error: "Respondent not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/respondents/:id/fd-history", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [respondent] = await db
    .select()
    .from(respondentsTable)
    .where(eq(respondentsTable.id, id));

  if (!respondent) {
    res.status(404).json({ error: "Respondent not found" });
    return;
  }

  const rows = await db
    .select({
      surveyId: allocationsTable.surveyId,
      shiftId: allocationsTable.shiftId,
      isManuallyAdjusted: allocationsTable.isManuallyAdjusted,
      month: surveysTable.month,
      year: surveysTable.year,
      surveyTitle: surveysTable.title,
      dayType: shiftsTable.dayType,
      durationHours: shiftsTable.durationHours,
      startTime: shiftsTable.startTime,
      endTime: shiftsTable.endTime,
      shiftDate: shiftsTable.date,
    })
    .from(allocationsTable)
    .innerJoin(surveysTable, eq(allocationsTable.surveyId, surveysTable.id))
    .innerJoin(shiftsTable, eq(allocationsTable.shiftId, shiftsTable.id))
    .where(eq(allocationsTable.respondentId, id));

  type HistoryBucket = {
    surveyId: number;
    month: number;
    year: number;
    surveyTitle: string;
    totalHours: number;
    shiftCount: number;
    weekdayShiftCount: number;
    weekendShiftCount: number;
    manualAdjustmentsCount: number;
    firstShiftDate: string | null;
    lastShiftDate: string | null;
  };

  const historyBySurvey = new Map<number, HistoryBucket>();

  for (const row of rows) {
    if (!historyBySurvey.has(row.surveyId)) {
      historyBySurvey.set(row.surveyId, {
        surveyId: row.surveyId,
        month: row.month,
        year: row.year,
        surveyTitle: row.surveyTitle,
        totalHours: 0,
        shiftCount: 0,
        weekdayShiftCount: 0,
        weekendShiftCount: 0,
        manualAdjustmentsCount: 0,
        firstShiftDate: row.shiftDate,
        lastShiftDate: row.shiftDate,
      });
    }

    const bucket = historyBySurvey.get(row.surveyId)!;
    bucket.totalHours += row.durationHours;
    bucket.shiftCount += 1;
    if (row.dayType === "weekday") bucket.weekdayShiftCount += 1;
    if (row.dayType === "weekend") bucket.weekendShiftCount += 1;
    if (row.isManuallyAdjusted) bucket.manualAdjustmentsCount += 1;

    if (bucket.firstShiftDate === null || row.shiftDate < bucket.firstShiftDate) {
      bucket.firstShiftDate = row.shiftDate;
    }
    if (bucket.lastShiftDate === null || row.shiftDate > bucket.lastShiftDate) {
      bucket.lastShiftDate = row.shiftDate;
    }
  }

  const monthlyHistory = Array.from(historyBySurvey.values()).sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );
  const slotPreferenceMap = new Map<
    string,
    { label: string; dayType: "weekday" | "weekend"; shiftCount: number; totalHours: number }
  >();

  for (const row of rows) {
    const start = formatTime12(row.startTime).replace(":00", "");
    const end = formatTime12(row.endTime).replace(":00", "");
    const label = `${row.dayType === "weekday" ? "Weekday" : "Weekend"} ${start} - ${end}`;
    const key = `${row.dayType}|${row.startTime}-${row.endTime}`;
    if (!slotPreferenceMap.has(key)) {
      slotPreferenceMap.set(key, {
        label,
        dayType: row.dayType as "weekday" | "weekend",
        shiftCount: 0,
        totalHours: 0,
      });
    }
    const bucket = slotPreferenceMap.get(key)!;
    bucket.shiftCount += 1;
    bucket.totalHours += row.durationHours;
  }

  const slotPreferences = Array.from(slotPreferenceMap.values()).sort(
    (a, b) => b.shiftCount - a.shiftCount || b.totalHours - a.totalHours || a.label.localeCompare(b.label),
  );

  const hourValues = monthlyHistory.map((entry) => entry.totalHours);
  const meanHours = computeAverage(hourValues);
  const medianHours = computeMedian(hourValues);
  const stdDevHours = computeStdDev(hourValues, meanHours);
  const firstHistoryEntry = monthlyHistory[0];
  const firstFrontDeskMonth = firstHistoryEntry
    ? `${String(firstHistoryEntry.month).padStart(2, "0")}/${firstHistoryEntry.year}`
    : "05/2026";

  res.json({
    respondent: {
      id: respondent.id,
      name: respondent.name,
      preferredName: respondent.preferredName,
      email: respondent.email,
      category: respondent.category,
    },
    summary: {
      monthsWithAllocations: monthlyHistory.length,
      totalAllocatedHours: hourValues.reduce((sum, value) => sum + value, 0),
      meanHours,
      averageHours: meanHours,
      medianHours,
      stdDevHours,
      maxHours: hourValues.length > 0 ? Math.max(...hourValues) : 0,
      minHours: hourValues.length > 0 ? Math.min(...hourValues) : 0,
      firstFrontDeskMonth,
    },
    monthlyHistory,
    slotPreferences,
  });
});

export default router;
