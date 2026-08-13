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
    // EAS project id is a public (non-secret) UUID; the EAS CLI resolves this
    // config statically (no env), so it must be present here. Env can override.
    eas: {
      projectId:
        process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
        "55090098-eb9a-4b03-b87c-fcd62c0781cd",
    },
  },
};

export default config;
