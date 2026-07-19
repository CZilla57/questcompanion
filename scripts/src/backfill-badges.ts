// One-time repair: grant every badge existing users already qualify for.
//   pnpm --filter @workspace/scripts backfill-badges
//   pnpm --filter @workspace/scripts backfill-badges -- --dry-run
//
// The badges table sat empty until 2026-07-19, so no badge was ever awarded
// however much a user had done. Live awarding (see `badge-awards.ts`) grants
// every passed tier on the next qualifying action, so this script is not
// strictly required — it just makes existing accounts correct immediately
// instead of on their next task completion.
//
// Idempotent: ON CONFLICT DO NOTHING against the user_badges unique index.
// Deliberately writes no `activity` rows — backdated grants would otherwise
// flood the feed with dozens of entries dated today.
import { pool } from "@workspace/db";

// Per-metric value for a user, matching the counters `badge-awards.ts` loads.
const METRIC_SQL = `
  CASE b.metric
    WHEN 'tasks_completed' THEN (SELECT count(*) FROM tasks t WHERE t.user_id = u.id AND t.completed)
    WHEN 'total_points'    THEN u.total_points
    WHEN 'streak_days'     THEN u.streak_days
    WHEN 'level'           THEN u.current_level
    WHEN 'habit_streak'    THEN COALESCE((SELECT max(hs.longest_streak) FROM habit_streaks hs WHERE hs.user_id = u.id), 0)
    WHEN 'allies'          THEN (SELECT count(*) FROM partnerships p
                                  WHERE p.status = 'accepted'
                                    AND (p.requester_id = u.id OR p.recipient_id = u.id))
    WHEN 'nudges_sent'     THEN (SELECT count(*) FROM ally_nudges n WHERE n.sender_id = u.id)
    WHEN 'boss_attacks'    THEN (SELECT count(*) FROM world_boss_attacks a WHERE a.user_id = u.id)
  END`;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const pending = await pool.query(`
    SELECT u.id AS user_id, u.username, b.name AS badge, b.category, b.requirement,
           ${METRIC_SQL} AS actual
    FROM users u
    CROSS JOIN badges b
    WHERE NOT EXISTS (
            SELECT 1 FROM user_badges ub WHERE ub.user_id = u.id AND ub.badge_id = b.id)
      AND ${METRIC_SQL} >= b.requirement
    ORDER BY u.id, b.category, b.requirement`);

  if (pending.rows.length === 0) {
    console.log("✓ nothing to backfill — every qualifying badge is already awarded");
    await pool.end();
    return;
  }

  console.table(pending.rows);
  if (dryRun) {
    console.log(`\n(dry run) would grant ${pending.rows.length} badges`);
    await pool.end();
    return;
  }

  const inserted = await pool.query(`
    INSERT INTO user_badges (user_id, badge_id)
    SELECT u.id, b.id
    FROM users u
    CROSS JOIN badges b
    WHERE ${METRIC_SQL} >= b.requirement
    ON CONFLICT DO NOTHING
    RETURNING user_id, badge_id`);

  console.log(`\n✓ backfilled ${inserted.rows.length} badges`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
