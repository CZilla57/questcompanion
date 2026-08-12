import { View, Text } from "react-native";
import { setBaseUrl } from "@workspace/api-client-react";

export default function Index() {
  // If this import resolves and the app renders, Metro + pnpm symlinks work.
  const resolved = typeof setBaseUrl === "function";
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>FocusQuest mobile shell</Text>
      <Text>workspace client resolved: {String(resolved)}</Text>
    </View>
  );
}
