import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, respondentsTable } from "@workspace/db";
import {
  CreateRespondentBody,
  UpdateRespondentBody,
  ListRespondentsResponse,
  UpdateRespondentResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/respondents", async (_req, res): Promise<void> => {
  const respondents = await db
    .select()
    .from(respondentsTable)
    .orderBy(respondentsTable.createdAt);
  res.json(ListRespondentsResponse.parse(respondents));
});

router.post("/respondents", async (req, res): Promise<void> => {
  const parsed = CreateRespondentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [respondent] = await db
    .insert(respondentsTable)
    .values({ name: parsed.data.name, email: parsed.data.email ?? null, category: parsed.data.category })
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

  const updateData: Partial<typeof respondentsTable.$inferInsert> = {};
  if (parsed.data.name !== null && parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.email !== undefined) updateData.email = parsed.data.email;
  if (parsed.data.category !== null && parsed.data.category !== undefined) updateData.category = parsed.data.category;

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

export default router;
