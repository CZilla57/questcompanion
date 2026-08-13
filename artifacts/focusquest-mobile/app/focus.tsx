import { View, Text } from "react-native";
import { Stack, Redirect } from "expo-router";
import { useGetActiveFocusSession } from "@workspace/api-client-react";
import { useAuth } from "../src/auth/auth-context";

export default function FocusRoute() {
  const { status } = useAuth();
  // Ungated fetch is safe: this route is only reached post-auth (DeepLinkRouter navigates here only when authed; the Redirect below guards any direct mount).
  const active = useGetActiveFocusSession();

  if (status === "loading") return <Centered><Text>Loading…</Text></Centered>;
  if (status !== "authed") return <Redirect href="/" />;

  const session = active.data ?? null;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Focus Session" }} />
      <Centered>
        <Text style={{ fontSize: 18, fontWeight: "600" }}>Focus</Text>
        <Text>
          {active.isLoading
            ? "Checking for an active session…"
            : session
              ? `Active session — status: ${session.status}`
              : "No active session right now."}
        </Text>
      </Centered>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, gap: 12, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {children}
    </View>
  );
}
