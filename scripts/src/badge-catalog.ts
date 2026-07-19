/**
 * The badge catalog — the source of truth seeded into the `badges` table.
 *
 * `category` drives UI grouping/colour; `metric` names the counter that
 * `requirement` is compared against.  Adding a badge here and re-running the
 * seed is enough — award logic is metric-driven and needs no code change.
 *
 * Point thresholds track the level curve in `gamification.ts` (L2=100, L4=500,
 * L6=1300, L8=2500, L10=4100) so an XP badge lands alongside a rank-up rather
 * than at an arbitrary number.
 *
 * Anti-shame law: every tier celebrates a thing done. The first tier of each
 * ladder is deliberately reachable on day one, and no badge is ever revoked
 * except by the explicit uncomplete/streak-break reversal paths.
 */
export interface BadgeSeed {
  name: string;
  description: string;
  icon: string;
  category: "tasks" | "points" | "streak" | "level" | "habit_streak" | "social";
  metric:
    | "tasks_completed" | "total_points" | "streak_days" | "level"
    | "habit_streak" | "allies" | "nudges_sent" | "boss_attacks";
  requirement: number;
}

export const BADGE_CATALOG: BadgeSeed[] = [
  // ── Task Mastery ──────────────────────────────────────────────────────────
  { name: "First Steps",         description: "Complete your first quest.",              icon: "CheckCircle", category: "tasks", metric: "tasks_completed", requirement: 1 },
  { name: "Getting Going",       description: "Complete 10 quests.",                     icon: "CheckCircle", category: "tasks", metric: "tasks_completed", requirement: 10 },
  { name: "Quest Seeker",        description: "Complete 25 quests.",                     icon: "Target",      category: "tasks", metric: "tasks_completed", requirement: 25 },
  { name: "Quest Hunter",        description: "Complete 50 quests.",                     icon: "Target",      category: "tasks", metric: "tasks_completed", requirement: 50 },
  { name: "Centurion",           description: "Complete 100 quests.",                    icon: "Trophy",      category: "tasks", metric: "tasks_completed", requirement: 100 },
  { name: "Quest Master",        description: "Complete 250 quests.",                    icon: "Trophy",      category: "tasks", metric: "tasks_completed", requirement: 250 },
  { name: "Legend of the Realm", description: "Complete 500 quests.",                    icon: "Crown",       category: "tasks", metric: "tasks_completed", requirement: 500 },

  // ── XP Milestones ─────────────────────────────────────────────────────────
  { name: "Spark Lit",     description: "Earn 100 XP.",    icon: "Zap",   category: "points", metric: "total_points", requirement: 100 },
  { name: "Finding Flow",  description: "Earn 500 XP.",    icon: "Zap",   category: "points", metric: "total_points", requirement: 500 },
  { name: "Driven",        description: "Earn 1,300 XP.",  icon: "Star",  category: "points", metric: "total_points", requirement: 1300 },
  { name: "Blazing",       description: "Earn 2,500 XP.",  icon: "Star",  category: "points", metric: "total_points", requirement: 2500 },
  { name: "Apex Ascended", description: "Earn 4,100 XP.",  icon: "Crown", category: "points", metric: "total_points", requirement: 4100 },
  { name: "Mythic",        description: "Earn 10,000 XP.", icon: "Crown", category: "points", metric: "total_points", requirement: 10000 },

  // ── Daily Streaks ─────────────────────────────────────────────────────────
  { name: "Warming Up",      description: "Reach a 3-day streak.",   icon: "Flame", category: "streak", metric: "streak_days", requirement: 3 },
  { name: "Week Warrior",    description: "Reach a 7-day streak.",   icon: "Flame", category: "streak", metric: "streak_days", requirement: 7 },
  { name: "Fortnight Flame", description: "Reach a 14-day streak.",  icon: "Flame", category: "streak", metric: "streak_days", requirement: 14 },
  { name: "Monthly Master",  description: "Reach a 30-day streak.",  icon: "Flame", category: "streak", metric: "streak_days", requirement: 30 },
  { name: "Unbroken",        description: "Reach a 60-day streak.",  icon: "Flame", category: "streak", metric: "streak_days", requirement: 60 },
  { name: "Eternal Flame",   description: "Reach a 100-day streak.", icon: "Flame", category: "streak", metric: "streak_days", requirement: 100 },

  // ── Rank Ups ──────────────────────────────────────────────────────────────
  { name: "Ignited",     description: "Reach Level 2 — Ignite.",   icon: "Shield", category: "level", metric: "level", requirement: 2 },
  { name: "Focused",     description: "Reach Level 3 — Focus.",    icon: "Shield", category: "level", metric: "level", requirement: 3 },
  { name: "In Momentum", description: "Reach Level 5 — Momentum.", icon: "Medal",  category: "level", metric: "level", requirement: 5 },
  { name: "Surging",     description: "Reach Level 7 — Surge.",    icon: "Medal",  category: "level", metric: "level", requirement: 7 },
  { name: "Apex Rank",   description: "Reach Level 10 — Apex.",    icon: "Crown",  category: "level", metric: "level", requirement: 10 },

  // ── Habit Streaks ─────────────────────────────────────────────────────────
  { name: "Habit Formed",       description: "Keep a habit going 7 days running.",   icon: "Calendar",   category: "habit_streak", metric: "habit_streak", requirement: 7 },
  { name: "Three Weeks Strong", description: "Keep a habit going 21 days running.",  icon: "Calendar",   category: "habit_streak", metric: "habit_streak", requirement: 21 },
  { name: "Ritual Keeper",      description: "Keep a habit going 50 days running.",  icon: "TrendingUp", category: "habit_streak", metric: "habit_streak", requirement: 50 },
  { name: "Unshakeable",        description: "Keep a habit going 100 days running.", icon: "TrendingUp", category: "habit_streak", metric: "habit_streak", requirement: 100 },

  // ── Social ────────────────────────────────────────────────────────────────
  { name: "Not Alone",     description: "Team up with your first ally.",       icon: "Users",  category: "social", metric: "allies",       requirement: 1 },
  { name: "Fellowship",    description: "Team up with 3 allies.",              icon: "Users",  category: "social", metric: "allies",       requirement: 3 },
  { name: "Cheerleader",   description: "Send 10 pokes or cheers.",            icon: "Rocket", category: "social", metric: "nudges_sent",  requirement: 10 },
  { name: "Hype Squad",    description: "Send 50 pokes or cheers.",            icon: "Rocket", category: "social", metric: "nudges_sent",  requirement: 50 },
  { name: "Into the Fray", description: "Land your first world boss attack.",  icon: "Medal",  category: "social", metric: "boss_attacks", requirement: 1 },
  { name: "Boss Slayer",   description: "Land 10 world boss attacks.",         icon: "Medal",  category: "social", metric: "boss_attacks", requirement: 10 },
  { name: "Raid Veteran",  description: "Land 25 world boss attacks.",         icon: "Award",  category: "social", metric: "boss_attacks", requirement: 25 },
];
