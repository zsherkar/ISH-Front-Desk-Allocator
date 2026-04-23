import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, surveysTable, shiftsTable, respondentsTable, responsesTable } from "@workspace/db";
import {
  SubmitResponseBody,
} from "@workspace/api-zod";
import { createRateLimit, requireSameOriginForBrowser } from "../lib/security.js";
import {
  dedupePositiveIntegerIds,
  FIELD_LIMITS,
  normalizeEmail,
  normalizeRequiredText,
} from "../lib/inputValidation.js";

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

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
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

router.post(
  "/respond/:surveyToken",
  requireSameOriginForBrowser,
  surveySubmitRateLimit,
  async (req, res): Promise<void> => {
    try {
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

      const nameResult = normalizeRequiredText(
        parsed.data.name,
        "Name",
        FIELD_LIMITS.respondentName,
      );
      if (!nameResult.ok) {
        res.status(400).json({ error: nameResult.error });
        return;
      }

      const preferredNameResult = normalizeRequiredText(
        parsed.data.preferredName,
        "Preferred name",
        FIELD_LIMITS.preferredName,
      );
      if (!preferredNameResult.ok) {
        res.status(400).json({ error: preferredNameResult.error });
        return;
      }

      const emailResult = normalizeEmail(parsed.data.email, { required: true });
      if (!emailResult.ok) {
        res.status(400).json({ error: emailResult.error });
        return;
      }
      if (!emailResult.value) {
        res.status(400).json({ error: "Email is required." });
        return;
      }

      const selectedShiftIds = dedupePositiveIntegerIds(parsed.data.selectedShiftIds);
      const preferredName = preferredNameResult.value;
      const category = parsed.data.category === "AFP" ? "AFP" : "General";
      const normalizedEmail = emailResult.value;
      const normalizedName = normalizeText(nameResult.value);
      const normalizedPreferredName = normalizeText(preferredName);

      if (!parsed.data.waiverAccepted) {
        res.status(400).json({ error: "You must accept the acknowledgment and release before submitting." });
        return;
      }

      if (selectedShiftIds.length === 0) {
        res.status(400).json({ error: "Please select at least one shift" });
        return;
      }

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

      const respondent = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(respondentsTable)
          .where(eq(respondentsTable.email, normalizedEmail))
          .limit(1);

        let nextRespondent = existing[0] ?? null;

        if (nextRespondent) {
          if (
            normalizeText(nextRespondent.name) !== normalizedName ||
            normalizeText(nextRespondent.preferredName) !== normalizedPreferredName
          ) {
            throw new Error(
              "These details do not match the saved record for this email. Use the same name details as previous surveys or contact an admin.",
            );
          }

          await tx
            .delete(responsesTable)
            .where(
              and(
                eq(responsesTable.surveyId, survey.id),
                eq(responsesTable.respondentId, nextRespondent.id),
              ),
            );
        } else {
          const [createdRespondent] = await tx
            .insert(respondentsTable)
            .values({
              name: nameResult.value,
              preferredName,
              email: normalizedEmail,
              category,
            })
            .returning();
          nextRespondent = createdRespondent;
        }

        for (const shiftId of selectedShiftIds) {
          await tx.insert(responsesTable).values({
            surveyId: survey.id,
            respondentId: nextRespondent.id,
            shiftId,
          });
        }

        return nextRespondent;
      });

      res.status(201).json({
        success: true,
        message: `Thank you ${respondent.preferredName || respondent.name}! Your availability has been recorded for ${selectedShiftIds.length} shift(s).`,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to store your availability right now.";
      res.status(message.includes("do not match the saved record") ? 409 : 500).json({
        error: message,
      });
    }
  },
);

export default router;
