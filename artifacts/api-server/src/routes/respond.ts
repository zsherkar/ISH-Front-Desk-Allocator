import { Router, type IRouter } from "express";
import { eq, and, ilike, or } from "drizzle-orm";
import { db, surveysTable, shiftsTable, respondentsTable, responsesTable } from "@workspace/db";
import {
  SubmitResponseBody,
  GetPublicSurveyResponse,
} from "@workspace/api-zod";
import { createRateLimit, requireSameOriginForBrowser } from "../lib/security.js";

const router: IRouter = Router();
const shouldAutoClose = (survey: { status: string; closesAt: Date | string | null }) =>
  survey.status === "open" && Boolean(survey.closesAt) && new Date(survey.closesAt as string) <= new Date();
const surveyReadRateLimit = createRateLimit({
  keyPrefix: "public-survey-read",
  windowMs: 5 * 60 * 1000,
  max: 120,
  message: "Too many survey requests. Please try again shortly.",
});
const surveySubmitRateLimit = createRateLimit({
  keyPrefix: "public-survey-submit",
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: "Too many submission attempts. Please wait and try again.",
});
const respondentLookupRateLimit = createRateLimit({
  keyPrefix: "public-respondent-lookup",
  windowMs: 5 * 60 * 1000,
  max: 40,
  message: "Too many lookup requests. Please try again shortly.",
});

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().replace(/\s+/g, " ").split(" ");
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

router.get("/respond/:surveyToken", surveyReadRateLimit, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");

  const token = Array.isArray(req.params.surveyToken)
    ? req.params.surveyToken[0]
    : req.params.surveyToken;

  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.token, token));
  if (!survey) {
    res.status(404).json({ error: "Survey not found" });
    return;
  }

  if (survey.status === "closed") {
    res.status(410).json({ error: "This survey is closed and no longer accepting responses" });
    return;
  }
  if (shouldAutoClose(survey)) {
    await db.update(surveysTable).set({ status: "closed" }).where(eq(surveysTable.id, survey.id));
    res.status(410).json({ error: "This survey is closed and no longer accepting responses" });
    return;
  }

  const shifts = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.surveyId, survey.id))
    .orderBy(shiftsTable.date, shiftsTable.startTime);

  res.json({
    id: survey.id,
    title: survey.title,
    month: survey.month,
    year: survey.year,
    status: survey.status,
    closesAt: survey.closesAt,
    shifts,
  });
});

router.get(
  "/respond/:surveyToken/respondents/lookup",
  respondentLookupRateLimit,
  async (req, res): Promise<void> => {
    const token = Array.isArray(req.params.surveyToken)
      ? req.params.surveyToken[0]
      : req.params.surveyToken;
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (query.length < 3) {
      res.json([]);
      return;
    }

    const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.token, token));
    if (!survey || survey.status === "closed" || shouldAutoClose(survey)) {
      res.json([]);
      return;
    }

    const respondents = await db
      .select({
        name: respondentsTable.name,
        preferredName: respondentsTable.preferredName,
        email: respondentsTable.email,
        category: respondentsTable.category,
      })
      .from(respondentsTable)
      .where(
        or(
          ilike(respondentsTable.name, `%${query}%`),
          ilike(respondentsTable.preferredName, `%${query}%`),
          ilike(respondentsTable.email, `%${query}%`),
        ),
      )
      .limit(5);

    res.json(
      respondents
        .filter((respondent) => respondent.email)
        .map((respondent) => {
          const { firstName, lastName } = splitName(respondent.name);
          return {
            firstName,
            lastName,
            email: respondent.email,
            preferredName: respondent.preferredName,
            category: respondent.category === "AFP" ? "AFP" : "General",
            updatedAt: new Date().toISOString(),
          };
        }),
    );
  },
);

router.post(
  "/respond/:surveyToken",
  requireSameOriginForBrowser,
  surveySubmitRateLimit,
  async (req, res): Promise<void> => {
  const token = Array.isArray(req.params.surveyToken)
    ? req.params.surveyToken[0]
    : req.params.surveyToken;

  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.token, token));
  if (!survey) {
    res.status(404).json({ error: "Survey not found" });
    return;
  }

  if (survey.status === "closed") {
    res.status(410).json({ error: "This survey is closed and no longer accepting responses" });
    return;
  }
  if (shouldAutoClose(survey)) {
    await db.update(surveysTable).set({ status: "closed" }).where(eq(surveysTable.id, survey.id));
    res.status(410).json({ error: "This survey is closed and no longer accepting responses" });
    return;
  }

  const parsed = SubmitResponseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, email, selectedShiftIds } = parsed.data;
  const preferredName = parsed.data.preferredName.trim();
  const category = parsed.data.category === "AFP" ? "AFP" : "General";
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedName = normalizeText(name);
  const normalizedPreferredName = normalizeText(preferredName);

  if (selectedShiftIds.length === 0) {
    res.status(400).json({ error: "Please select at least one shift" });
    return;
  }

  // Verify all selected shifts belong to this survey
  const shifts = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.surveyId, survey.id));

  const validShiftIds = new Set(shifts.map((s) => s.id));
  const invalidShifts = selectedShiftIds.filter((id) => !validShiftIds.has(id));
  if (invalidShifts.length > 0) {
    res.status(400).json({ error: "Invalid shift IDs selected" });
    return;
  }

  // Use email as the canonical public identifier to avoid cross-respondent collisions.
  let respondent = null;

  const existing = await db
    .select()
    .from(respondentsTable)
    .where(eq(respondentsTable.email, normalizedEmail));

  if (existing.length > 0) {
    respondent = existing[0];

    if (
      normalizeText(respondent.name) !== normalizedName ||
      normalizeText(respondent.preferredName) !== normalizedPreferredName
    ) {
      res.status(409).json({
        error:
          "These details do not match the saved record for this email. Use the same name details as previous surveys or contact an admin.",
      });
      return;
    }

    await db
      .delete(responsesTable)
      .where(
        and(
          eq(responsesTable.surveyId, survey.id),
          eq(responsesTable.respondentId, respondent.id),
        ),
      );
  } else {
    const [newRespondent] = await db
      .insert(respondentsTable)
      .values({
        name: name.trim(),
        preferredName,
        email: normalizedEmail,
        category,
      })
      .returning();
    respondent = newRespondent;
  }

  // Insert responses
  for (const shiftId of selectedShiftIds) {
    await db.insert(responsesTable).values({
      surveyId: survey.id,
      respondentId: respondent.id,
      shiftId,
    });
  }

  res.status(201).json({
    success: true,
    message: `Thank you ${respondent.preferredName || respondent.name}! Your availability has been recorded for ${selectedShiftIds.length} shift(s).`,
  });
});

export default router;
