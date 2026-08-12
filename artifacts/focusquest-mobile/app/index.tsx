import { View, Text, Button, Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "../src/auth/auth-context";

export default function Index() {
  const { status, login, logout } = useAuth();

  const me = useQuery({
    enabled: status === "authed",
    queryKey: ["me"],
    queryFn: () => customFetch<{ id: number }>("/api/users/me"),
  });

  // TEMPORARY (G3 verification only) — remove with the /devices/test-send
  // endpoint once native push is verified (see runbook Task 10).
  async function sendTest() {
    try {
      const result = await customFetch("/api/devices/test-send", { method: "POST" });
      Alert.alert("Test send", JSON.stringify(result));
    } catch (err) {
      Alert.alert("Test send failed", String(err));
    }
  }

  if (status === "loading") return <Centered><Text>Loading…</Text></Centered>;
  if (status === "anon")
    return <Centered><Button title="Log in with Auth0" onPress={() => login()} /></Centered>;

  return (
    <Centered>
      <Text>Authenticated ✓</Text>
      <Text>me: {me.isLoading ? "…" : JSON.stringify(me.data ?? me.error)}</Text>
      <Button title="Send test notification" onPress={() => sendTest()} />
      <Button title="Log out" onPress={() => logout()} />
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, gap: 12, alignItems: "center", justifyContent: "center" }}>{children}</View>;
}
