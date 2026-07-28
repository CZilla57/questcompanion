/**
 * Decides whether a failed migration should abort the boot or be tolerated.
 *
 * The original rule — any failure exits non-zero — was written to stop the
 * server serving against a half-migrated database. It also meant an entirely
 * healthy build could not boot whenever the database was merely unreachable:
 * on 2026-07-28 an exhausted database compute quota crash-looped the container
 * for hours, because every restart re-ran migrations and every run failed.
 *
 * Drizzle applies each migration inside a transaction, so an environmental
 * failure rolls back rather than leaving a partial schema. That makes the
 * distinction safe to draw: a *statement* that is wrong stays fatal, while the
 * database being absent, throttled or refusing service is transient.
 */

/**
 * SQLSTATE classes that mean the migration SQL itself is wrong. These will fail
 * identically on every retry and on every future boot, so there is nothing to
 * wait for — the deploy should stop.
 *
 *   22 — data exception (bad cast, overflow, invalid value)
 *   23 — integrity constraint violation (a backfill that can't satisfy an FK)
 *   42 — syntax error or access rule violation (typo, missing column)
 */
const FATAL_SQLSTATE_CLASSES = ["22", "23", "42"];

/** A Postgres SQLSTATE is exactly five alphanumeric characters, e.g. `42601`. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

export type MigrationFailure = "fatal" | "transient";

/**
 * `transient` is the default on purpose. Node network errors surface a string
 * code (`ECONNREFUSED`), a throttled or suspended database answers with a
 * server-class SQLSTATE (`XX000`, `53300`, `57P03`), and an unrecognised shape
 * tells us nothing — none of those are evidence that the migration is wrong,
 * and refusing to boot for them is what caused the outage this guards against.
 */
export function classifyMigrationFailure(err: unknown): MigrationFailure {
  const code = extractCode(err);
  if (!code || !SQLSTATE.test(code)) return "transient";
  return FATAL_SQLSTATE_CLASSES.includes(code.slice(0, 2)) ? "fatal" : "transient";
}

/**
 * Drizzle wraps driver errors, so the SQLSTATE we care about is usually on
 * `cause` rather than the thrown error. Walks the chain and takes the first
 * code that looks like a SQLSTATE, so a wrapper's own string code can't mask
 * a real one underneath.
 */
function extractCode(err: unknown): string | undefined {
  let fallback: string | undefined;

  for (let cur = err, depth = 0; cur && depth < 10; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") {
      if (SQLSTATE.test(code)) return code;
      fallback ??= code;
    }
    cur = (cur as { cause?: unknown }).cause;
  }

  return fallback;
}
