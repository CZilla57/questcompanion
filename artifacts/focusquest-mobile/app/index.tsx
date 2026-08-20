import { View, Text, Button } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "../src/auth/auth-context";

export default function Index() {
  const { status, login, logout } = useAuth();
  const router = useRouter();

  const me = useQuery({
    enabled: status === "authed",
    queryKey: ["me"],
    queryFn: () => customFetch<{ id: number }>("/api/users/me"),
  });

  if (status === "loading") return <Centered><Text>Loading…</Text></Centered>;
  if (status === "anon")
    return <Centered><Button title="Log in with Auth0" onPress={() => login()} /></Centered>;

  return (
    <Centered>
      <Text>Authenticated ✓</Text>
      <Text>me: {me.isLoading ? "…" : JSON.stringify(me.data ?? me.error)}</Text>
      <Button title="Start Focus" onPress={() => router.push("/focus")} />
      <Button title="Evening reflection" onPress={() => router.push("/reflection")} />
      <Button title="Log out" onPress={() => logout()} />
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, gap: 12, alignItems: "center", justifyContent: "center" }}>{children}</View>;
}
