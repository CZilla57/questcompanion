import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const partnershipsTable = pgTable("partnerships", {
  id: serial("id").primaryKey(),
  requesterId: integer("requester_id").notNull().references(() => usersTable.id),
  recipientId: integer("recipient_id").notNull().references(() => usersTable.id),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, () => ({
  uniquePair: {
    name: "partnerships_unique_pair",
    columns: [sql`LEAST(requester_id, recipient_id)`, sql`GREATEST(requester_id, recipient_id)`],
    unique: true,
  },
}));

export type Partnership = typeof partnershipsTable.$inferSelect;
