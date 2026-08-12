import { Stack } from "expo-router";
import Constants from "expo-constants";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resolveApiUrl, configureApiClient, setBaseUrl } from "../src/api/configure-client";
import { getToken } from "../src/auth/token-store";

setBaseUrl(resolveApiUrl(Constants.expoConfig?.extra));
configureApiClient(getToken);

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
