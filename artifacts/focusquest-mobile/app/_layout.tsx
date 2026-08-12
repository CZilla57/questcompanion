import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resolveApiUrl, configureApiClient, setBaseUrl } from "../src/api/configure-client";
import { getToken } from "../src/auth/token-store";
import { AuthProvider } from "../src/auth/auth-context";

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
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    function routeToResponse(response: Notifications.NotificationResponse | null | undefined) {
      const url = response?.notification.request.content.data?.url;
      if (typeof url === "string" && url.trim() !== "") {
        router.push(url as never);
      }
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      routeToResponse(response);
    });

    // Handle the cold-start case: the app was launched by tapping a notification.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!cancelled) {
        routeToResponse(response);
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
