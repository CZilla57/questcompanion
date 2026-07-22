// Act VII q7: the single source of truth for "which tables hold a user's
// data". DELETE /api/me and GET /api/me/export both walk this list, and
// account-data.test.ts walks the drizzle schema to prove the list is
// complete — adding a user-keyed table without registering it fails CI.
//
// Order is FK-safe for deletion (children before the tables they reference;
// the users row itself is deleted after the whole list). Tables with two user
// columns (partnerships, ally_nudges) match on EITHER — the relationship dies
// with the account. world_boss_weeks.totalDamage is intentionally untouched:
// the shared raid's history keeps its total after the attacker rows vanish.
import { eq, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  activityTable, allyNudgesTable, apiTokensTable, bodyDoubleMembersTable, bodyDoubleRoomsTable,
  bodyDoubleSprintsTable, brainCheckinsTable, campaignsTable, coinTransactionsTable,
  dopamineRewardsTable, focusSessionsTable, habitStreaksTable, initiationAwardsTable,
  kingdomPointsTable, partnershipsTable, pushSubscriptionsTable, questlinesTable,
  recurringTasksTable, reflectionsTable, rescueEventsTable, rewardStoreItemsTable,
  taskStepsTable, tasksTable, userBadgesTable, userGearTable, weeklyBattlesTable,
  weeklyRecapsTable, worldBossAttacksTable,
} from "@workspace/db/schema";

export interface UserDataTable {
  name: string;               // export key + log name
  table: PgTable;
  userColumns: AnyPgColumn[]; // one per user-FK column on the table
}

export const USER_DATA_TABLES: readonly UserDataTable[] = [
  // Children that reference tasks/questlines/etc. come before their parents.
  { name: "task_steps",         table: taskStepsTable,        userColumns: [taskStepsTable.userId] },
  { name: "focus_sessions",     table: focusSessionsTable,    userColumns: [focusSessionsTable.userId] },
  { name: "rescue_events",      table: rescueEventsTable,     userColumns: [rescueEventsTable.userId] },
  { name: "tasks",              table: tasksTable,            userColumns: [tasksTable.userId] },
  // habit_streaks holds a non-cascading FK into recurring_tasks — child first.
  { name: "habit_streaks",      table: habitStreaksTable,     userColumns: [habitStreaksTable.userId] },
  { name: "recurring_tasks",    table: recurringTasksTable,   userColumns: [recurringTasksTable.userId] },
  { name: "questlines",         table: questlinesTable,       userColumns: [questlinesTable.userId] },
  // Quest Campaigns: chapters (questlines) unlink above, so the campaign row
  // is safe to delete once its questlines are gone.
  { name: "campaigns",          table: campaignsTable,        userColumns: [campaignsTable.userId] },
  { name: "activity",           table: activityTable,         userColumns: [activityTable.userId] },
  { name: "brain_checkins",     table: brainCheckinsTable,    userColumns: [brainCheckinsTable.userId] },
  { name: "reflections",        table: reflectionsTable,      userColumns: [reflectionsTable.userId] },
  { name: "weekly_recaps",      table: weeklyRecapsTable,     userColumns: [weeklyRecapsTable.userId] },
  { name: "initiation_awards",  table: initiationAwardsTable, userColumns: [initiationAwardsTable.userId] },
  { name: "kingdom_points",     table: kingdomPointsTable,    userColumns: [kingdomPointsTable.userId] },
  { name: "coin_transactions",  table: coinTransactionsTable, userColumns: [coinTransactionsTable.userId] },
  { name: "dopamine_rewards",   table: dopamineRewardsTable,  userColumns: [dopamineRewardsTable.userId] },
  { name: "reward_store_items", table: rewardStoreItemsTable, userColumns: [rewardStoreItemsTable.userId] },
  { name: "user_badges",        table: userBadgesTable,       userColumns: [userBadgesTable.userId] },
  { name: "user_gear",          table: userGearTable,         userColumns: [userGearTable.userId] },
  { name: "weekly_battles",     table: weeklyBattlesTable,    userColumns: [weeklyBattlesTable.userId] },
  { name: "world_boss_attacks", table: worldBossAttacksTable, userColumns: [worldBossAttacksTable.userId] },
  // Body-double children before rooms; my hosted rooms cascade their other
  // members'/sprints' rows at the DB level (all room FKs cascade).
  { name: "body_double_sprints", table: bodyDoubleSprintsTable, userColumns: [bodyDoubleSprintsTable.startedBy] },
  { name: "body_double_members", table: bodyDoubleMembersTable, userColumns: [bodyDoubleMembersTable.userId] },
  { name: "body_double_rooms",   table: bodyDoubleRoomsTable,   userColumns: [bodyDoubleRoomsTable.hostId] },
  { name: "push_subscriptions", table: pushSubscriptionsTable, userColumns: [pushSubscriptionsTable.userId] },
  // Pocket Gate shortcut tokens: sha256 digests only — one-way, so exporting
  // them is harmless; deleting them here kills home-screen access with the account.
  { name: "api_tokens",         table: apiTokensTable,        userColumns: [apiTokensTable.userId] },
  { name: "ally_nudges",        table: allyNudgesTable,       userColumns: [allyNudgesTable.senderId, allyNudgesTable.recipientId] },
  { name: "partnerships",       table: partnershipsTable,     userColumns: [partnershipsTable.requesterId, partnershipsTable.recipientId] },
] as const;

/** WHERE matching this user on ANY of the table's user columns. */
export function userWhere(t: UserDataTable, userId: number): SQL {
  const conds = t.userColumns.map((c) => eq(c, userId));
  return conds.length === 1 ? conds[0]! : or(...conds)!;
}
