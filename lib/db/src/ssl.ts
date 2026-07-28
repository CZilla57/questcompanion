import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

/**
 * The CA bundle used for database connections.
 *
 * Supabase's pooler presents a chain rooted in its own `Supabase Root 2021 CA`,
 * which is not in any public trust store — without it, node-postgres fails the
 * handshake with SELF_SIGNED_CERT_IN_CHAIN.
 *
 * Note `ca` *replaces* Node's default roots rather than adding to them, so we
 * concatenate the system roots. That keeps publicly-trusted hosts (Neon, a
 * managed Postgres elsewhere) working against the same build.
 *
 * The production image copies the cert to an absolute path and points
 * DATABASE_CA_CERT_PATH at it, the same way DRIZZLE_MIGRATIONS_DIR overrides
 * the migrations folder — the bundled entry doesn't sit where this source does.
 */
const packageCertPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../certs/supabase-ca.crt",
);

export function databaseSsl(): { ca: string[]; rejectUnauthorized: true } | undefined {
  const configured = process.env.DATABASE_CA_CERT_PATH;
  const certPath = configured ?? packageCertPath;

  if (!fs.existsSync(certPath)) {
    // An explicitly configured path that isn't there is a deployment fault, not
    // a reason to continue. Returning undefined here would hand node-postgres a
    // config with no `ssl` at all, and its default is *no TLS* — so a typo in
    // this one env var would quietly downgrade a verified connection to
    // plaintext. Fail loudly instead.
    if (configured) {
      throw new Error(
        `DATABASE_CA_CERT_PATH is set to "${configured}" but no file exists there. ` +
          `Refusing to connect without TLS.`,
      );
    }
    console.warn(
      `[db] no CA certificate at ${certPath} — connecting WITHOUT TLS. ` +
        `Set DATABASE_CA_CERT_PATH for any non-local database.`,
    );
    return undefined;
  }

  return {
    ca: [...tls.rootCertificates, fs.readFileSync(certPath, "utf8")],
    // Verifies the chain *and* the hostname — the equivalent of libpq's
    // sslmode=verify-full. Anything weaker would leave the connection
    // impersonatable, which is the whole point of shipping the CA.
    rejectUnauthorized: true,
  };
}
