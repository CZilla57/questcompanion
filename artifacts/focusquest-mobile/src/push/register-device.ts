import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { customFetch } from "@workspace/api-client-react";

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null; // Simulator cannot receive push.

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );

  await customFetch("/api/devices", {
    method: "POST",
    body: JSON.stringify({ token, provider: "expo" }),
  });
  return token;
}

export async function deregisterPush(token: string): Promise<void> {
  await customFetch(`/api/devices/${encodeURIComponent(token)}`, { method: "DELETE" });
}
