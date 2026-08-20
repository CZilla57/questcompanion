import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, Redirect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTodayReflection,
  getGetTodayReflectionQueryKey,
  useAnswerTodayReflection,
  getGetMyStatsQueryKey,
  type Reflection,
  type ReflectionChip,
} from "@workspace/api-client-react";
import { HELPED_CHIPS, HINDERED_CHIPS, CHIP_LABELS } from "../src/lib/reflection-chips";
import { apiErrorMessage } from "../src/lib/api-error";
import { buildReflectionAnswer, canSubmitReflection, isAnswered } from "../src/reflection/derivations";
import { Card, PrimaryButton, SecondaryButton, Chip } from "../src/components/ui";
import { useToast } from "../src/toast/toast";
import { useAuth } from "../src/auth/auth-context";

function ChipGroup({ title, chips, selected, onToggle }: {
  title: string;
  chips: ReflectionChip[];
  selected: Set<ReflectionChip>;
  onToggle: (chip: ReflectionChip) => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.chips}>
        {chips.map((chip) => (
          <Chip key={chip} label={CHIP_LABELS[chip]} active={selected.has(chip)} onPress={() => onToggle(chip)} />
        ))}
      </View>
    </View>
  );
}

export default function ReflectionRoute() {
  const { status } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Ungated fetch is safe: reached only post-auth (DeepLinkRouter navigates here only when
  // authed; the Redirect below guards any direct mount). draft:true drafts today's prompt,
  // matching the web reflection page.
  const { data, isLoading } = useGetTodayReflection({ tz, draft: true });
  const answer = useAnswerTodayReflection();

  const [selected, setSelected] = useState<Set<ReflectionChip>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [editing, setEditing] = useState(false);

  const reflection: Reflection | null = data?.reflection ?? null;
  const answered = isAnswered(reflection, editing);

  function toggle(chip: ReflectionChip) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  }

  function submit() {
    answer.mutate(
      { data: buildReflectionAnswer([...selected], freeText, tz) },
      {
        onSuccess: async () => {
          // The screen fetches with draft=true; the dashboard card fetches without —
          // invalidate each so the evening card hides after answering, plus stats.
          await qc.invalidateQueries({ queryKey: getGetTodayReflectionQueryKey({ tz, draft: true }) });
          await qc.invalidateQueries({ queryKey: getGetTodayReflectionQueryKey({ tz }) });
          await qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
          setEditing(false);
        },
        onError: (err) =>
          toast({ title: "Couldn't save", description: apiErrorMessage(err, "Please try again.") }),
      },
    );
  }

  // Auth guard (kept from #4). All hooks above run unconditionally before any return.
  if (status === "loading") return <Centered><Text>Loading…</Text></Centered>;
  if (status !== "authed") return <Redirect href="/" />;

  const header = <Stack.Screen options={{ headerShown: true, title: "Reflection" }} />;

  if (isLoading) {
    return (
      <>
        {header}
        <Centered><Text>Setting up tonight's reflection…</Text></Centered>
      </>
    );
  }

  return (
    <>
      {header}
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <Text style={styles.heading}>🌙 Evening reflection</Text>
          {reflection?.prompt ? <Text style={styles.prompt}>{reflection.prompt}</Text> : null}

          {answered ? (
            <View style={styles.answered}>
              {reflection!.chips.length > 0 ? (
                <View style={styles.chips}>
                  {reflection!.chips.map((chip) => (
                    <Chip key={chip} label={CHIP_LABELS[chip as ReflectionChip] ?? chip} active />
                  ))}
                </View>
              ) : null}
              {reflection!.freeText ? <Text style={styles.freeText}>&quot;{reflection!.freeText}&quot;</Text> : null}
              {reflection!.ack ? <Text style={styles.ack}>✨ {reflection!.ack}</Text> : null}
              <SecondaryButton
                title="Edit tonight's answer"
                onPress={() => {
                  setSelected(new Set(reflection!.chips as ReflectionChip[]));
                  setFreeText(reflection!.freeText ?? "");
                  setEditing(true);
                }}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <ChipGroup title="What helped?" chips={HELPED_CHIPS} selected={selected} onToggle={toggle} />
              <ChipGroup title="What got in the way?" chips={HINDERED_CHIPS} selected={selected} onToggle={toggle} />
              <TextInput
                style={styles.input}
                value={freeText}
                onChangeText={setFreeText}
                maxLength={500}
                multiline
                placeholder="Anything else? (optional)"
              />
              <PrimaryButton
                title={answer.isPending ? "Saving…" : "Done"}
                onPress={submit}
                disabled={answer.isPending || !canSubmitReflection(selected.size, freeText)}
              />
            </View>
          )}
        </Card>
      </ScrollView>
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

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  heading: { fontSize: 18, fontWeight: "600" },
  prompt: { fontSize: 16 },
  group: { gap: 8 },
  groupTitle: { fontSize: 14, fontWeight: "500", color: "#6b7280" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  form: { gap: 16 },
  answered: { gap: 12 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 12, minHeight: 72, textAlignVertical: "top" },
  freeText: { fontStyle: "italic", color: "#6b7280" },
  ack: { color: "#6366f1" },
});
