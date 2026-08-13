import { View, Text } from "react-native";
import { Stack, Redirect } from "expo-router";
import { useGetTodayReflection } from "@workspace/api-client-react";
import { useAuth } from "../src/auth/auth-context";

export default function ReflectionRoute() {
  const { status } = useAuth();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = useGetTodayReflection({ tz });

  if (status === "loading") return <Centered><Text>Loading…</Text></Centered>;
  if (status !== "authed") return <Redirect href="/" />;

  const reflection = today.data?.reflection ?? null;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Reflection" }} />
      <Centered>
        <Text style={{ fontSize: 18, fontWeight: "600" }}>Today's reflection</Text>
        <Text style={{ textAlign: "center" }}>
          {today.isLoading
            ? "Loading today's prompt…"
            : reflection
              ? `${reflection.prompt}${reflection.answeredAt ? " (answered ✓)" : ""}`
              : "No reflection prompt yet today."}
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
