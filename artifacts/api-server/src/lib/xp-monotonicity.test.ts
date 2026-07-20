import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ── Standing regression guard (Act VII, Honest Coin — spec §6) ──────────────
// XP is progression, coins are the spendable currency. `totalPoints` /
// `weeklyPoints` may only decrease in the quest-uncomplete award reversal
// (routes/tasks.ts, snapshot-bounded, clamped at 0), and no activity row may
// ever be written with negative points. Adding a file to an allowlist below
// requires either an award-reversal justification (like tasks.ts) or provably
// pure non-write math (like gamification.ts) — a purchase never qualifies.

const SRC = join(__dirname, "..");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const files = tsFiles(SRC).map((p) => ({
  rel: relative(SRC, p).replace(/\\/g, "/"),
  src: readFileSync(p, "utf8"),
}));

// `totalPoints - x` after any reference (member access OR destructured local) —
// the bare-identifier form subsumes `.totalPoints - x`.
const XP_DECREMENT = /\b(totalPoints|weeklyPoints)\s*-(?!-)/;
// `sql`${usersTable.totalPoints} - x`` — a SQL-side decrement.
const SQL_DECREMENT = /\$\{usersTable\.(totalPoints|weeklyPoints)\}\s*-/;
// `points: -x` — a negative-points activity row (the coin ledger uses `amount:`,
// so it never trips this).
const NEGATIVE_ACTIVITY_POINTS = /points:\s*-/;

const XP_DECREMENT_ALLOWLIST = new Set([
  "routes/tasks.ts",     // uncomplete reversal: bounded by the completion's own snapshot
  "lib/gamification.ts", // pure level math on a caller-supplied param — no user-row writes
]);

describe("XP monotonicity (standing guard)", () => {
  it("only the uncomplete reversal may decrement totalPoints/weeklyPoints", () => {
    const offenders = files
      .filter((f) => !XP_DECREMENT_ALLOWLIST.has(f.rel))
      .filter((f) => XP_DECREMENT.test(f.src) || SQL_DECREMENT.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the allowlist is honest: tasks.ts still contains the reversal", () => {
    const tasks = files.find((f) => f.rel === "routes/tasks.ts");
    expect(tasks && XP_DECREMENT.test(tasks.src)).toBe(true);
  });

  it("no code path writes a negative-points activity row", () => {
    const offenders = files
      .filter((f) => NEGATIVE_ACTIVITY_POINTS.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the legacy XP shield endpoint stays dead", () => {
    const users = files.find((f) => f.rel === "routes/users.ts");
    expect(users?.src.includes("streak-freeze/buy")).toBe(false);
    expect(users?.src.includes("FREEZE_COST")).toBe(false);
  });

  it("gear never touches XP columns", () => {
    const gear = files.find((f) => f.rel === "routes/gear.ts");
    expect(gear).toBeDefined();
    expect(/(totalPoints|weeklyPoints|currentLevel):\s/.test(gear!.src)).toBe(false);
  });
});
