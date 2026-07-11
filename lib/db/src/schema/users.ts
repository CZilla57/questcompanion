import { pgTable, serial, text, integer, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  externalId: varchar("external_id").unique(),
  username: text("username").notNull().unique(),
  displayName: text("display_name"),
  avatarColor: text("avatar_color").notNull().default("#6366f1"),
  totalPoints: integer("total_points").notNull().default(0),
  weeklyPoints: integer("weekly_points").notNull().default(0),
  currentLevel: integer("current_level").notNull().default(1),
  streakDays: integer("streak_days").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastActiveDate: text("last_active_date"),
  streakFreezes: integer("streak_freezes").notNull().default(0),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  avatarClass: text("avatar_class").notNull().default("fighter"),
  avatarSkin: text("avatar_skin").notNull().default("light"),
  avatarHairStyle: text("avatar_hair_style").notNull().default("short"),
  avatarHairColor: text("avatar_hair_color").notNull().default("brown"),
  avatarBodyBuild: text("avatar_body_build").notNull().default("male"),
  avatarFace: text("avatar_face").notNull().default("neutral"),
  avatarBeardStyle: text("avatar_beard_style").notNull().default("none"),
  avatarBeardColor: text("avatar_beard_color").notNull().default("brown"),
  avatarGlasses: text("avatar_glasses").notNull().default("none"),
  avatarEarrings: text("avatar_earrings").notNull().default("none"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
