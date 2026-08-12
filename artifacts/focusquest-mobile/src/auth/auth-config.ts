export interface AuthConfig {
  issuer: string;
  clientId: string;
}

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

// Pure helper: resolves the Auth0 issuer + clientId from expo `extra`.
// Throws a single Error naming BOTH env vars when either value is missing
// or blank, so misconfiguration is diagnosable from one message.
export function resolveAuthConfig(extra: unknown): AuthConfig {
  const record =
    extra && typeof extra === "object" ? (extra as Record<string, unknown>) : {};

  const domainRaw = record.auth0Domain;
  const clientIdRaw = record.auth0ClientId;

  const domain = typeof domainRaw === "string" ? domainRaw.trim() : "";
  const clientId = typeof clientIdRaw === "string" ? clientIdRaw.trim() : "";

  if (domain === "" || clientId === "") {
    throw new Error(
      "Auth0 is not configured: both EXPO_PUBLIC_AUTH0_DOMAIN and EXPO_PUBLIC_AUTH0_CLIENT_ID " +
        "(expo extra.auth0Domain / extra.auth0ClientId) must be set.",
    );
  }

  return { issuer: `https://${normalizeDomain(domain)}`, clientId };
}
