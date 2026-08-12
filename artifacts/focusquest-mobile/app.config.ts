import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "FocusQuest",
  slug: "focusquest-mobile",
  scheme: "focusquest",
  version: "0.0.1",
  orientation: "portrait",
  ios: {
    bundleIdentifier: "app.focusquest.mobile",
    supportsTablet: false,
  },
  plugins: ["expo-router", "expo-secure-store", "expo-web-browser", "expo-notifications"],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
    auth0Domain: process.env.EXPO_PUBLIC_AUTH0_DOMAIN ?? null,
    auth0ClientId: process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID ?? null,
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? undefined },
  },
};

export default config;
