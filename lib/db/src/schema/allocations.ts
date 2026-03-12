import { pgTable, text, serial, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { surveysTable } from "./surveys";
import { respondentsTable } from "./respondents";
import { shiftsTable } from "./shifts";

export const allocationsTable = pgTable("allocations", {
  id: serial("id").primaryKey(),
  surveyId: integer("survey_id").notNull().references(() => surveysTable.id, { onDelete: "cascade" }),
  respondentId: integer("respondent_id").notNull().references(() => respondentsTable.id, { onDelete: "cascade" }),
  shiftId: integer("shift_id").notNull().references(() => shiftsTable.id, { onDelete: "cascade" }),
  isManuallyAdjusted: boolean("is_manually_adjusted").notNull().default(false),
  penaltyNote: text("penalty_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAllocationSchema = createInsertSchema(allocationsTable).omit({ id: true, createdAt: true });
export type InsertAllocation = z.infer<typeof insertAllocationSchema>;
export type Allocation = typeof allocationsTable.$inferSelect;
