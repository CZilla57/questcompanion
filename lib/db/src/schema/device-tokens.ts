import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const deviceTokensTable = pgTable(
  "device_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id),
    provider: text("provider").notNull(), // 'expo' | 'apns'
    token: text("token").notNull(),
    platform: text("platform").notNull().default("ios"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    providerToken: unique("device_tokens_provider_token_key").on(t.provider, t.token),
  }),
);

export type DeviceToken = typeof deviceTokensTable.$inferSelect;
