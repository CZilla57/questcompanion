// One-shot for Act VII q6: resize an ALREADY-materialized World Boss week to
// the new cohort formula (the formula otherwise applies only to weeks
// materialized after deploy — W30 was created under the old 5000-cap curve).
// Run via:
//   pnpm --filter @workspace/scripts reseed-world-boss-week [weekKey]
// e.g. `... reseed-world-boss-week 2026-W30`. With no arg it targets the week
// current at RUN time — pass the key explicitly if the week may have rolled
// over since deploy, or the stale week silently keeps its old HP.
//
// Constants mirror api-server's lib/world-boss.ts (HP_PER_CONTRIBUTOR /
// HP_MIN) — a one-shot script may duplicate them rather than reach into an
// app package; must track lib/world-boss.ts and lib/week-key.ts if re-run later.
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

// Monday (UTC) of an ISO week key — ISO week 1 contains Jan 4. Lets the
// prior week derive from the TARGET week, not from the wall clock.
function isoWeekMonday(weekKey: string): Date {
  const m = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`Invalid week key: ${weekKey} (expected e.g. 2026-W30)`);
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1));
  const monday = new Date(mondayW1);
  monday.setUTCDate(mondayW1.getUTCDate() + (Number(m[2]) - 1) * 7);
  return monday;
}

async function main() {
  const weekKey = process.argv[2] ?? getWeekKey(new Date());
  const priorKey = getWeekKey(new Date(isoWeekMonday(weekKey).getTime() - 7 * 86400000));

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
