import { assignPoints } from "./auto-points";

export interface StarterQuest {
  title: string;
}

// Seeded once when an account is first created so new users don't land on empty pages.
// Titles are deliberately chosen so assignPoints() maps each to a *distinct* category
// (health, learning, household, deep_work) — this keeps points/categories consistent
// with user-created quests instead of hardcoding them here.
export const STARTER_QUESTS: readonly StarterQuest[] = [
  { title: "Take a 10-minute walk" },
  { title: "Read for 15 minutes" },
  { title: "Tidy up your desk" },
  { title: "Plan your top 3 tasks for today" },
];

// Shape is a valid subset of the tasks insert type; kept db-free so this module stays
// pure and unit-testable (importing @workspace/db throws without DATABASE_URL).
export interface StarterQuestRow {
  userId: number;
  title: string;
  points: number;
  category: string;
  priority: string;
  dueDate: string;
}

/**
 * Build the task rows to seed for a brand-new user. `today` is a YYYY-MM-DD string
 * (UTC), matching the dueDate convention used across the task routes.
 */
export function buildStarterQuestRows(userId: number, today: string): StarterQuestRow[] {
  const priority = "medium";
  return STARTER_QUESTS.map(({ title }) => {
    const { points, category } = assignPoints(title, priority);
    return { userId, title, points, category, priority, dueDate: today };
  });
}
