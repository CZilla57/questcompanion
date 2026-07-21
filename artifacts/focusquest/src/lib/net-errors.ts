// A failure that never got an HTTP answer: fetch's TypeError, or an abort
// (the capture path's 10s timeout). ApiError/ResponseParseError from
// @workspace/api-client-react carry a numeric .status — those are server
// answers and must NOT be treated as dead zones.
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (typeof err !== "object" || err === null) return false;
  if (typeof (err as { status?: unknown }).status === "number") return false;
  return (err as { name?: unknown }).name === "AbortError";
}

/** The capture path's stash trigger: no HTTP answer at all, or a 5xx — the
 * server being down/cold-starting endangers the thought exactly like a dead
 * zone, and the replay policy already treats 5xx as retryable. 4xx stays a
 * real rejection. (Voice transcribe deliberately does NOT use this: its 503
 * means "not configured" — a persistent state with its own honest message.) */
export function isDeadZoneError(err: unknown): boolean {
  if (isNetworkError(err)) return true;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 500;
}
