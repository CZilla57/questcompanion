import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const recurringTasksTable = pgTable("recurring_tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  category: text("category").notNull().default("default"),
  // Weekly: the set of weekdays. nth_weekday mode: the single weekday of the
  // rule — reusing this NOT NULL column instead of adding a redundant one.
  daysOfWeek: text("days_of_week").notNull().default("1,2,3,4,5"),
  timeOfDay: text("time_of_day").notNull().default("08:00"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  // 'weekly' | 'monthly' | 'yearly'. Existing rows default to weekly, which
  // with the columns below NULL reproduces the pre-cadence behavior exactly.
  frequency: text("frequency").notNull().default("weekly"),
  // 'day_of_month' | 'nth_weekday'. Required when frequency is not weekly.
  monthlyMode: text("monthly_mode"),
  dayOfMonth: integer("day_of_month"),
  // 1–4, or -1 meaning "last". Never 5 — most months don't have a 5th.
  weekOfMonth: integer("week_of_month"),
  monthOfYear: integer("month_of_year"),
  // How many days before the occurrence the quest appears in the Quest Log.
  // The spawned quest still carries the true occurrence date as its due date.
  leadDays: integer("lead_days").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type RecurringTask = typeof recurringTasksTable.$inferSelect;
