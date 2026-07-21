import { logger } from "./logger";

/** Dead-man's switch (Act VII q7): after a successful tick, GET the
 * healthchecks.io-style URL in HEARTBEAT_URL. The monitor alerts on a GAP in
 * pings, so this must be best-effort — env unset is a silent no-op, and no
 * failure here may ever fail the tick. */
export async function pingHeartbeat(fetchFn: typeof fetch = fetch): Promise<boolean> {
  const url = process.env.HEARTBEAT_URL;
  if (!url) return false;
  try {
    const res = await fetchFn(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Heartbeat ping got a non-2xx response");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "Heartbeat ping failed");
    return false;
  }
}
