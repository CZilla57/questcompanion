export type Priority = "low" | "medium" | "high";

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
}
