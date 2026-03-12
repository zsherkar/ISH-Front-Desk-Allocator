import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const respondentsTable = pgTable("respondents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  category: text("category").notNull().default("General"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRespondentSchema = createInsertSchema(respondentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRespondent = z.infer<typeof insertRespondentSchema>;
export type Respondent = typeof respondentsTable.$inferSelect;
