import type { ReactNode } from "react";
import { Pressable, Text, View, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from "react-native";

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function BaseButton({
  title,
  onPress,
  disabled,
  style,
  textStyle,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.btn, style, (disabled || pressed) && styles.btnDim]}
    >
      <Text style={textStyle}>{title}</Text>
    </Pressable>
  );
}

export function PrimaryButton(p: { title: string; onPress: () => void; disabled?: boolean }) {
  return <BaseButton {...p} style={styles.primary} textStyle={styles.primaryText} />;
}

export function SecondaryButton(p: { title: string; onPress: () => void; disabled?: boolean }) {
  return <BaseButton {...p} style={styles.secondary} textStyle={styles.secondaryText} />;
}

export function DestructiveButton(p: { title: string; onPress: () => void; disabled?: boolean }) {
  return <BaseButton {...p} style={styles.destructive} textStyle={styles.destructiveText} />;
}

export function Dot({ active }: { active: boolean }) {
  return <View style={[styles.dot, active ? styles.dotOn : styles.dotOff]} />;
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={onPress ? { selected: active } : undefined}
      style={[styles.chip, active ? styles.chipOn : styles.chipOff]}
    >
      <Text style={active ? styles.chipTextOn : styles.chipTextOff}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 20, gap: 12, backgroundColor: "#ffffff" },
  btn: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, alignItems: "center", justifyContent: "center", minWidth: 96 },
  btnDim: { opacity: 0.5 },
  primary: { backgroundColor: "#6366f1" },
  primaryText: { color: "#ffffff", fontWeight: "600" },
  secondary: { borderWidth: 1, borderColor: "#d1d5db", backgroundColor: "#ffffff" },
  secondaryText: { color: "#111827", fontWeight: "600" },
  destructive: { backgroundColor: "#dc2626" },
  destructiveText: { color: "#ffffff", fontWeight: "600" },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotOn: { backgroundColor: "#6366f1" },
  dotOff: { backgroundColor: "#e5e7eb" },
  chip: { borderWidth: 1, borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { borderColor: "#6366f1", backgroundColor: "#eef2ff" },
  chipOff: { borderColor: "#d1d5db", backgroundColor: "#ffffff" },
  chipTextOn: { color: "#4338ca", fontSize: 13 },
  chipTextOff: { color: "#111827", fontSize: 13 },
});
