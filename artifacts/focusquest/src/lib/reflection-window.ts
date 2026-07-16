/** Local hour at which the evening reflection card/window opens. */
export const REFLECTION_CARD_START_HOUR = 17;

/** Dashboard evening-card visibility: local 17:00 → midnight, unanswered only.
 * An unanswered day simply disappears at midnight — no badge, no backlog
 * (anti-shame). */
export function eveningCardVisible(now: Date, answeredToday: boolean): boolean {
  return !answeredToday && now.getHours() >= REFLECTION_CARD_START_HOUR;
}
