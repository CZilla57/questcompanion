// Capture idempotency (Never Lose a Thought): the client mints one UUID per
// capture and reuses it across timeout-retries and offline replays. Bounds are
// defensive — the web client always sends crypto.randomUUID() (36 chars).
export const CLIENT_KEY_MIN = 8;
export const CLIENT_KEY_MAX = 64;

export function isValidClientKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= CLIENT_KEY_MIN &&
    value.length <= CLIENT_KEY_MAX
  );
}
