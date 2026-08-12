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
  plugins: ["expo-router", "expo-secure-store"],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
  },
};

export default config;
