import {
  Award, Calendar, CheckCircle2, Crown, Flame, Medal, Rocket,
  Shield, Star, Target, TrendingUp, Trophy, Users, Zap,
} from "lucide-react";
import type { ComponentType } from "react";

/** Maps a badge's stored `icon` string to its lucide component. */
const BADGE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  CheckCircle: CheckCircle2,
  Zap,
  Trophy,
  Medal,
  Flame,
  Star,
  Crown,
  Calendar,
  Target,
  Rocket,
  TrendingUp,
  Shield,
  Users,
  Award,
};

/** Renders the icon for a badge's `icon` string, falling back to `Award`. */
export function BadgeIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = BADGE_ICONS[icon] ?? Award;
  return <Icon className={className} />;
}

export interface BadgeCategoryStyle {
  label: string;
  color: string;
  bg: string;
  border: string;
}

export const BADGE_CATEGORY_STYLE: Record<string, BadgeCategoryStyle> = {
  tasks:        { label: "Task Mastery",  color: "text-primary",    bg: "bg-primary/10",    border: "border-primary/30" },
  points:       { label: "XP Milestones", color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/30" },
  streak:       { label: "Daily Streaks", color: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/30" },
  level:        { label: "Rank Ups",      color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/30" },
  social:       { label: "Social",        color: "text-green-400",  bg: "bg-green-400/10",  border: "border-green-400/30" },
  habit_streak: { label: "Habit Streaks", color: "text-amber-400",  bg: "bg-amber-400/10",  border: "border-amber-500/40" },
};

/** Fallback style for an unrecognized badge category. */
export const DEFAULT_BADGE_CATEGORY_STYLE: BadgeCategoryStyle = BADGE_CATEGORY_STYLE.tasks!;

/**
 * Returns the `n` badges with the newest `earnedAt` first.
 * Pure — does not mutate the input; tolerates undefined/empty input.
 */
export function pickRecentBadges<T extends { earnedAt: string }>(
  badges: T[] | undefined,
  n: number,
): T[] {
  if (!badges) return [];
  return [...badges]
    .sort((a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime())
    .slice(0, n);
}
