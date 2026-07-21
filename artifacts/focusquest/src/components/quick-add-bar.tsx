import { useMemo, useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { Sparkles, CalendarClock, Zap, Plus, RefreshCw, Mic, Square } from "lucide-react";
import { parseQuickAdd, type ParsedQuickAdd } from "@workspace/quick-add";
import { useParseQuickAdd, getGetTasksQueryKey, getGetTasksMomentumQueryKey, getGetQuestlinesQueryKey, getGetQuestlineQueryKey, type TaskInput } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CATEGORY_HEX_COLORS, CATEGORY_LABEL } from "@/lib/categories";
import { formatTime12h } from "@/lib/format-time";
import { useVoiceRecording } from "@/hooks/use-voice-recording";
import { isTooShortToTranscribe, formatElapsed } from "@/lib/voice-recording";
import { isNetworkError, isDeadZoneError } from "@/lib/net-errors";
import { makeTextEntry, makeVoiceEntry, newCaptureId } from "@/lib/outbox/core";
import { getOutboxStore } from "@/lib/outbox/store";
import { createTaskWithTimeout, transcribeWithTimeout } from "@/lib/outbox/api";

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return format(new Date(y, m - 1, d), "EEE MMM d");
}

export function QuickAddBar({ selectedDate, questlineId }: { selectedDate: Date | undefined; questlineId?: number }) {
  const [text, setText] = useState("");
  const [aiFields, setAiFields] = useState<ParsedQuickAdd | null>(null);
  const [xp, setXp] = useState<number | null>(null);
  const [stashing, setStashing] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Direct call instead of the orval hook so the capture path controls its
  // timeout signal and can classify server-answer vs dead-zone failures.
  const createMutation = useMutation({
    mutationFn: (input: TaskInput & { clientKey: string }) => createTaskWithTimeout(input),
  });
  const parseMutation = useParseQuickAdd();

  // Deterministic parse runs live on every keystroke.
  const det = useMemo(() => parseQuickAdd(text, { now: new Date() }), [text]);

  // A Smart-parse (AI) result overlays ONLY the fields it actually resolved — it never
  // clobbers a deterministic value with undefined. Category stays deterministic (explicit
  // #tag only) per spec, so an AI-inferred category is never merged in or sent to create.
  const parsed = useMemo<ParsedQuickAdd>(() => {
    if (!aiFields) return det;
    const merged: ParsedQuickAdd = { ...det };
    if (aiFields.dueDate) merged.dueDate = aiFields.dueDate;
    if (aiFields.dueTime) merged.dueTime = aiFields.dueTime;
    if (aiFields.priority) merged.priority = aiFields.priority;
    if (!merged.title) merged.title = aiFields.title;
    return merged;
  }, [det, aiFields]);

  // Track the current text so an in-flight Smart-parse can detect a stale response.
  const textRef = useRef(text);
  useEffect(() => { textRef.current = text; }, [text]);

  // Reuse the existing points/category endpoint for the XP + auto-category chip.
  useEffect(() => {
    if (!parsed.title.trim()) { setXp(null); return; }
    const t = setTimeout(() => {
      fetch(`/api/tasks/suggest-points?title=${encodeURIComponent(parsed.title)}&priority=${parsed.priority ?? "medium"}`)
        .then((r) => r.json())
        .then((d: { points: number }) => setXp(d.points))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [parsed.title, parsed.priority]);

  const canCreate = parsed.title.trim().length > 0 && !createMutation.isPending && !stashing;
  const showSmartParse = parsed.title.trim().length > 0 && !parsed.dueDate && !parsed.dueTime;

  const stashCapture = async (input: TaskInput & { clientKey: string }) => {
    setStashing(true);
    try {
      const store = await getOutboxStore();
      await store.add(makeTextEntry(input));
      toast(
        store.persistent
          ? { title: "Saved — will sync when you're back online ✓", className: "border-primary" }
          : { title: "Can't save to this browser — keep the app open until you're back online." },
      );
      setText("");
      setAiFields(null);
    } catch {
      // Storage itself failed (quota, tx abort). The text is still sitting in
      // the input — nothing is lost; say so plainly instead of failing silent.
      toast({ title: "Couldn't save that capture — your text is still here, try again.", variant: "destructive" });
    } finally {
      setStashing(false);
    }
  };

  const stashVoice = async (blob: Blob, durationMs: number) => {
    try {
      const store = await getOutboxStore();
      await store.add(makeVoiceEntry(blob, durationMs, questlineId != null ? { questlineId } : {}));
      toast(
        store.persistent
          ? { title: "Voice note saved — I'll transcribe it when you're back online", className: "border-primary" }
          : { title: "Can't save to this browser — keep the app open until you're back online." },
      );
    } catch {
      toast({ title: "Couldn't save the voice note — try again, or type it.", variant: "destructive" });
    }
  };

  const handleCreate = () => {
    if (!canCreate) return;
    const dueDate = parsed.dueDate ?? format(selectedDate ?? new Date(), "yyyy-MM-dd");
    const input: TaskInput & { clientKey: string } = {
      title: parsed.title,
      dueDate,
      priority: (parsed.priority ?? "medium") as any,
      ...(parsed.dueTime ? { dueTime: parsed.dueTime } : {}),
      ...(parsed.category ? { category: parsed.category as any } : {}),
      ...(questlineId != null ? { questlineId } : {}),
      // Every create carries a key — double-taps and timed-out-but-landed
      // requests dedupe server-side instead of duplicating.
      clientKey: newCaptureId(),
    };
    if (!navigator.onLine) { void stashCapture(input); return; }
    createMutation.mutate(input, {
      onSuccess: (task) => {
        toast({ title: `Quest added — ${task.points} XP`, className: "border-primary" });
        setText("");
        setAiFields(null);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
        if (questlineId != null) {
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetQuestlineQueryKey(questlineId) });
        }
      },
      onError: (err) => {
        if (isDeadZoneError(err)) { void stashCapture(input); return; }
        toast({ title: "Couldn't add that quest", variant: "destructive" });
      },
    });
  };

  const handleSmartParse = (next?: string) => {
    const requested = next ?? text;
    // Keep the stale-response guard in sync when invoked with text that hasn't
    // rendered yet (the voice path calls this in the same tick as setText).
    textRef.current = requested;
    parseMutation.mutate({ data: { text: requested, today: format(new Date(), "yyyy-MM-dd") } }, {
      onSuccess: (result) => {
        // Ignore a response for text the user has since edited.
        if (textRef.current !== requested) return;
        setAiFields({
          title: result.title,
          dueDate: result.dueDate ?? undefined,
          dueTime: result.dueTime ?? undefined,
          priority: result.priority ?? undefined,
        });
      },
      onError: (err: any) => {
        const status = err?.status;
        const msg =
          status === 503 ? "Smart parse isn't set up yet."
          : status === 429 ? "Give it a moment and try again."
          : "Couldn't smart-parse — edit the line manually.";
        toast({ title: msg, variant: "destructive" });
      },
    });
  };

  // Not the orval hook: it JSON.stringifies Blob bodies, and a hung upload
  // must abort into the stash path instead of spinning forever — both live in
  // transcribeWithTimeout (see lib/outbox/api.ts). Error shaping
  // (ApiError.status) still comes from the shared client.
  const transcribeMutation = useMutation({
    mutationFn: (blob: Blob) => transcribeWithTimeout(blob),
  });

  const voice = useVoiceRecording({
    onClip: (blob, durationMs, autoStopped) => {
      if (isTooShortToTranscribe(durationMs)) {
        toast({ title: "Didn't catch that — try again or type it.", variant: "destructive" });
        return;
      }
      if (autoStopped) {
        toast({ title: "Hit the 60-second limit — transcribing what I got." });
      }
      if (!navigator.onLine) {
        void stashVoice(blob, durationMs);
        return;
      }
      transcribeMutation.mutate(blob, {
        onSuccess: ({ text: transcript }) => {
          if (!transcript.trim()) {
            toast({ title: "Didn't catch that — try again or type it.", variant: "destructive" });
            return;
          }
          setText(transcript);
          setAiFields(null);
          // Spoken phrasing is free-form — run Smart parse without an extra tap.
          // Cheap even when unneeded: /tasks/parse short-circuits server-side
          // when the deterministic parser already resolved a date/time.
          handleSmartParse(transcript);
        },
        onError: (err: any) => {
          if (isNetworkError(err)) { void stashVoice(blob, durationMs); return; }
          const status = err?.status;
          const msg =
            status === 503 ? "Voice input isn't set up yet."
            : status === 429 ? "Give it a moment and try again."
            : "Couldn't transcribe — try typing it.";
          toast({ title: msg, variant: "destructive" });
        },
      });
    },
    onError: (kind) =>
      toast({
        title:
          kind === "denied"
            ? "Mic access is blocked — enable it in your browser settings."
            : "Couldn't start recording.",
        variant: "destructive",
      }),
  });

  return (
    <div className="bg-card border border-primary/30 rounded-xl p-3 space-y-2 shadow-[0_0_15px_rgba(0,255,255,0.06)]">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => { setText(e.target.value); setAiFields(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
          placeholder="Quick add — e.g. Email Sam tomorrow 3pm #work !high"
          aria-label="Quick add a quest in natural language"
          className="border-primary/20 focus:border-primary"
        />
        {voice.supported && (
          <Button
            type="button"
            variant="outline"
            onClick={() => (voice.recording ? voice.stop() : voice.start())}
            disabled={transcribeMutation.isPending}
            aria-pressed={voice.recording}
            aria-label={voice.recording ? "Stop recording" : "Start voice input"}
            className={`shrink-0 border-primary/20 ${voice.recording ? "text-destructive" : "text-muted-foreground hover:text-primary"}`}
          >
            {voice.recording ? (
              <span className="flex items-center gap-1">
                <Square className="w-3 h-3 fill-current animate-pulse" />
                <span className="text-xs tabular-nums">{formatElapsed(voice.elapsedMs)}</span>
              </span>
            ) : transcribeMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </Button>
        )}
        <Button onClick={handleCreate} disabled={!canCreate} className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0">
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>

      {parsed.title.trim() && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {parsed.dueDate && (
            <span aria-label="Due date" className="px-2 py-0.5 rounded-full border border-border bg-muted/40 flex items-center gap-1">
              <CalendarClock className="w-3 h-3" />
              {dateLabel(parsed.dueDate)}{parsed.dueTime ? ` · ${formatTime12h(parsed.dueTime)}` : ""}
            </span>
          )}
          {!parsed.dueDate && parsed.dueTime && (
            <span aria-label="Due time" className="px-2 py-0.5 rounded-full border border-border bg-muted/40 flex items-center gap-1">
              <CalendarClock className="w-3 h-3" /> {formatTime12h(parsed.dueTime)}
            </span>
          )}
          {parsed.priority && (
            <span aria-label="Priority" className="px-2 py-0.5 rounded-full border border-border bg-muted/40 capitalize">
              {parsed.priority} priority
            </span>
          )}
          {parsed.category && (
            <span aria-label="Category" className="px-2 py-0.5 rounded-full border" style={{ color: CATEGORY_HEX_COLORS[parsed.category], borderColor: `${CATEGORY_HEX_COLORS[parsed.category]}55` }}>
              {CATEGORY_LABEL[parsed.category] ?? parsed.category}
            </span>
          )}
          {xp !== null && (
            <span aria-label="Experience points" className="px-2 py-0.5 rounded-full border border-primary/30 text-primary flex items-center gap-1">
              <Zap className="w-3 h-3" /> {xp} XP
            </span>
          )}
          {showSmartParse && (
            <Button variant="ghost" size="sm" onClick={() => handleSmartParse()} disabled={parseMutation.isPending} className="h-6 px-2 text-xs text-muted-foreground hover:text-primary gap-1">
              {parseMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Smart parse
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
