export type Priority = "low" | "medium" | "high";
export type Frequency = "weekly" | "monthly" | "yearly";
export type MonthlyMode = "day_of_month" | "nth_weekday";

export interface ParsedRecurrence {
  /** weekly/monthly/yearly — the server model has no "daily"; daily is weekly with all 7 days. */
  frequency: Frequency;
  /** 0=Sun..6=Sat. The weekly set, or the single weekday for an nth_weekday monthly rule. */
  daysOfWeek?: number[];
  monthlyMode?: MonthlyMode;
  dayOfMonth?: number; // 1..31
  weekOfMonth?: number; // 1..4
  monthOfYear?: number; // 1..12
}

export interface ParsedQuickAdd {
  /** The task text, with all recognized tokens stripped and whitespace collapsed. */
  title: string;
  /** YYYY-MM-DD in the caller's local calendar, if a date was parsed. */
  dueDate?: string;
  /** HH:mm 24-hour, if a time was parsed. */
  dueTime?: string;
  /** Only set when an explicit `!priority` token was present. */
  priority?: Priority;
  /** Canonical category slug, only when an explicit `#tag` matched. */
  category?: string;
  /** Set only when the line describes a repeating quest; absent for one-off lines. */
  recurrence?: ParsedRecurrence;
}
