import { Stack } from "expo-router";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resolveApiUrl, configureApiClient, setBaseUrl } from "../src/api/configure-client";
import { getToken } from "../src/auth/token-store";
import { AuthProvider } from "../src/auth/auth-context";
import { DeepLinkRouter } from "../src/routing/deep-link-routing";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

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
        <DeepLinkRouter />
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
