import { Stack } from "expo-router";
import Constants from "expo-constants";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resolveApiUrl, configureApiClient, setBaseUrl } from "../src/api/configure-client";
import { getToken } from "../src/auth/token-store";
import { AuthProvider } from "../src/auth/auth-context";

const extra = Constants.expoConfig?.extra;
const rawApiUrl =
  extra && typeof extra === "object" ? (extra as Record<string, unknown>).apiUrl : undefined;
if (typeof rawApiUrl === "string" && rawApiUrl.trim() !== "") {
  setBaseUrl(resolveApiUrl(extra));
} else {
  console.warn(
    "EXPO_PUBLIC_API_URL is not configured (expo extra.apiUrl) - continuing without an API base URL.",
  );
}
configureApiClient(getToken);

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
