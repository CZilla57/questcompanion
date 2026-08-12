import { Stack } from "expo-router";

export default function RootLayout() {
  // @ts-expect-error expo-router's Stack type resolves through a react-navigation
  // instance whose ambient "react" import climbs past this package's local
  // node_modules into pnpm's shared virtual-store hoist folder, which pins a
  // different (React 19) @types/react than this app's own (React 18). This is a
  // types-only artifact of the workspace's mixed React 18/19 versions; it does not
  // affect the compiled/runtime component. See iosc-task-1-report.md.
  return <Stack screenOptions={{ headerShown: false }} />;
}
