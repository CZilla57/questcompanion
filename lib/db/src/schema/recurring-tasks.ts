import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const recurringTasksTable = pgTable("recurring_tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  daysOfWeek: text("days_of_week").notNull().default("1,2,3,4,5"),
  timeOfDay: text("time_of_day").notNull().default("08:00"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type RecurringTask = typeof recurringTasksTable.$inferSelect;
