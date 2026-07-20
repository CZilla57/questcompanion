import type { NotificationPrefs } from "@workspace/api-client-react";

export type PrefCategoryKey = keyof Pick<NotificationPrefs, "protection" | "reminders" | "reflection" | "hero">;

export const PREF_CATEGORIES: { key: PrefCategoryKey; label: string; hint: string }[] = [
  { key: "protection", label: "Self-care nudges", hint: "Water, food, wind-down during long focus" },
  { key: "reminders",  label: "Quest reminders",  hint: "Due today, power window, quick wins" },
  { key: "reflection", label: "Evening reflection", hint: "One gentle prompt, evenings only" },
  { key: "hero",       label: "Hero & world",     hint: "Hunger, milestones, flavor" },
];

export function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}
