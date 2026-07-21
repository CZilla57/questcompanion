// One-shot for Act VII q6: resize the ALREADY-materialized current World Boss
// week to the new cohort formula (the formula otherwise applies only to weeks
// materialized after deploy — W30 was created under the old 5000-cap curve).
// Run via:
//   pnpm --filter @workspace/scripts reseed-world-boss-week
//
// Constants mirror api-server's lib/world-boss.ts (HP_PER_CONTRIBUTOR /
// HP_MIN) — a one-shot script may duplicate them rather than reach into an
// app package.
//
// Guards:
//  - never touches a defeated week (payout already settled);
//  - never sets hp <= totalDamage: a stored total >= hp would make
//    crossedThreshold unreachable and the defeat payout could never fire.
// Idempotent: re-running recomputes the same target.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool, worldBossWeeksTable, worldBossAttacksTable } from "@workspace/db";

const HP_PER_CONTRIBUTOR = 300;
const HP_MIN = 300;

// Same ISO week-key math as api-server's lib/week-key.ts.
function getWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function main() {
  const now = new Date();
  const weekKey = getWeekKey(now);
  const priorKey = getWeekKey(new Date(now.getTime() - 7 * 86400000));

  const [prior] = await db
    .select({ n: sql<number>`count(distinct ${worldBossAttacksTable.userId})`.mapWith(Number) })
    .from(worldBossAttacksTable)
    .where(eq(worldBossAttacksTable.weekKey, priorKey));
  const cohort = prior?.n ?? 0;
  const targetHp = Math.max(HP_MIN, cohort * HP_PER_CONTRIBUTOR);

  const updated = await db.update(worldBossWeeksTable)
    .set({ hp: sql`greatest(${targetHp}, ${worldBossWeeksTable.totalDamage} + 1)` })
    .where(and(eq(worldBossWeeksTable.weekKey, weekKey), isNull(worldBossWeeksTable.defeatedAt)))
    .returning();

  if (updated.length === 0) {
    console.log(`No live boss row for ${weekKey} (not materialized yet, or already defeated) — nothing to do.`);
  } else {
    console.log(`✓ resized ${weekKey}: cohort=${cohort} (week ${priorKey}) → hp=${updated[0]!.hp} (totalDamage=${updated[0]!.totalDamage})`);
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
