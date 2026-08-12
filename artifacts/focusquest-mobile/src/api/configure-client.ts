import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";

export function resolveApiUrl(extra: unknown): string {
  const url =
    extra && typeof extra === "object"
      ? (extra as Record<string, unknown>).apiUrl
      : undefined;
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("EXPO_PUBLIC_API_URL is not configured (expo extra.apiUrl)");
  }
  return url.trim();
}

export function configureApiClient(
  tokenGetter: () => Promise<string | null>,
): void {
  setAuthTokenGetter(tokenGetter);
}

export { setBaseUrl };
