import { pgTable, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { surveysTable } from "./surveys";
import { respondentsTable } from "./respondents";
import { shiftsTable } from "./shifts";

export const responsesTable = pgTable("responses", {
  id: serial("id").primaryKey(),
  surveyId: integer("survey_id").notNull().references(() => surveysTable.id, { onDelete: "cascade" }),
  respondentId: integer("respondent_id").notNull().references(() => respondentsTable.id, { onDelete: "cascade" }),
  shiftId: integer("shift_id").notNull().references(() => shiftsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertResponseSchema = createInsertSchema(responsesTable).omit({ id: true, createdAt: true });
export type InsertResponse = z.infer<typeof insertResponseSchema>;
export type Response = typeof responsesTable.$inferSelect;
