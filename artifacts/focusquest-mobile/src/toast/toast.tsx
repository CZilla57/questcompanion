import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Text, View, StyleSheet } from "react-native";
import { Card } from "../components/ui";

export interface ToastInput {
  title: string;
  description?: string;
}

interface ToastValue {
  toast(input: ToastInput): void;
}

const ToastContext = createContext<ToastValue | null>(null);
const DURATION_MS = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastInput | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest toast wins: replace the visible banner and reset its dismiss timer.
  const toast = useCallback((input: ToastInput) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCurrent(input);
    timerRef.current = setTimeout(() => setCurrent(null), DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {current ? (
        <View style={styles.wrap} pointerEvents="none">
          <Card>
            <Text style={styles.title}>{current.title}</Text>
            {current.description ? <Text style={styles.desc}>{current.description}</Text> : null}
          </Card>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 60, left: 16, right: 16, alignItems: "stretch" },
  title: { fontWeight: "700" },
  desc: { color: "#6b7280", marginTop: 2 },
});
