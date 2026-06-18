import { pgTable, serial, integer, varchar, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const dopamineRewardsTable = pgTable("dopamine_rewards", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  rewardText: varchar("reward_text", { length: 100 }).notNull(),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});
