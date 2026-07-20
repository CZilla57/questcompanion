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
