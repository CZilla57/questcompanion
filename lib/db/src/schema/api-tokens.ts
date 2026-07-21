import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Pocket Gate: personal-access tokens for the iPhone Shortcuts flows.
// Only the sha256 hex digest of the secret is stored — the plaintext is shown
// once at mint and never persisted. Revocation is soft (revoked_at set), so
// the Settings list can show what existed and when it was last used.
export const apiTokensTable = pgTable(
  "api_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("idx_api_tokens_user").on(t.userId)],
);
