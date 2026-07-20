import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The exactly-once replay guarantee is the partial unique index, not app code.
// This guard fails if a future squash/rewrite of migrations drops it.
const drizzleDir = fileURLToPath(new URL("../../../../lib/db/drizzle", import.meta.url));

describe("capture idempotency schema guard (Never Lose a Thought)", () => {
  it("migration history creates the partial unique index on (user_id, client_key)", () => {
    const allSql = readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(path.join(drizzleDir, f), "utf8"))
      .join("\n");
    const idx = /CREATE UNIQUE INDEX (?:IF NOT EXISTS )?"tasks_user_client_key_unique" ON "tasks"[^;]*"user_id"[^;]*"client_key"[^;]*WHERE[^;]*client_key[^;]*IS NOT NULL/s;
    expect(allSql).toMatch(idx);
  });
});
