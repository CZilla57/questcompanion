/**
 * Pull a human-readable message out of an API error, falling back if absent.
 *
 * Prefers the server's `{ error: string }` body (surfaced on the thrown error's
 * `data`), then a native `Error.message`, then the provided fallback.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown } | null)?.data;
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
