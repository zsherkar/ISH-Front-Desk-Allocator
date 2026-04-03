import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, surveysTable, shiftsTable, respondentsTable, responsesTable } from "@workspace/db";
import {
  SubmitResponseBody,
  GetPublicSurveyResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const shouldAutoClose = (survey: { status: string; closesAt: Date | string | null }) =>
  survey.status === "open" && Boolean(survey.closesAt) && new Date(survey.closesAt as string) <= new Date();

router.get("/respond/:surveyToken", async (req, res): Promise<void> => {
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

router.post("/respond/:surveyToken", async (req, res): Promise<void> => {
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
  const preferredName = typeof req.body?.preferredName === "string" ? req.body.preferredName.trim() : "";
  const category = req.body?.category === "AFP" ? "AFP" : "General";

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

  // Find or create respondent by name (within this survey context)
  let respondent = null;

  // Check if this respondent already submitted for this survey
  if (email) {
    const existing = await db
      .select()
      .from(respondentsTable)
      .where(eq(respondentsTable.email, email));

    if (existing.length > 0) {
      respondent = existing[0];
      // Delete their existing responses for this survey
      await db
        .delete(responsesTable)
        .where(
          and(
            eq(responsesTable.surveyId, survey.id),
            eq(responsesTable.respondentId, respondent.id)
          )
        );
    }
  }

  if (!respondent) {
    // Look for a respondent with the same name (case insensitive) who hasn't responded to this survey
    const existingByName = await db
      .select()
      .from(respondentsTable);

    const matchByName = existingByName.find(
      (r) => r.name.toLowerCase() === name.toLowerCase()
    );

    if (matchByName) {
      respondent = matchByName;
      // Delete their existing responses for this survey (re-submission)
      await db
        .delete(responsesTable)
        .where(
          and(
            eq(responsesTable.surveyId, survey.id),
            eq(responsesTable.respondentId, respondent.id)
          )
        );
    } else {
      // Create new respondent
      const [newRespondent] = await db
        .insert(respondentsTable)
        .values({
          name,
          preferredName: preferredName || name.split(" ")[0] || name,
          email: email ?? null,
          category,
        })
        .returning();
      respondent = newRespondent;
    }
  }

  await db
    .update(respondentsTable)
    .set({
      name,
      preferredName: preferredName || respondent.preferredName || name.split(" ")[0] || name,
      email: email ?? respondent.email,
      category,
    })
    .where(eq(respondentsTable.id, respondent.id));

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
    message: `Thank you ${name}! Your availability has been recorded for ${selectedShiftIds.length} shift(s).`,
  });
});

export default router;
