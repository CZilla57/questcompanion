import { useMemo, useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { Sparkles, CalendarClock, Zap, Plus, RefreshCw } from "lucide-react";
import { parseQuickAdd, type ParsedQuickAdd } from "@workspace/quick-add";
import { useCreateTask, useParseQuickAdd, getGetTasksQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CATEGORY_HEX_COLORS, CATEGORY_LABEL } from "@/lib/categories";

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return format(new Date(y, m - 1, d), "EEE MMM d");
}

export function QuickAddBar({ selectedDate }: { selectedDate: Date | undefined }) {
  const [text, setText] = useState("");
  const [aiFields, setAiFields] = useState<ParsedQuickAdd | null>(null);
  const [xp, setXp] = useState<number | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateTask();
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

  const canCreate = parsed.title.trim().length > 0 && !createMutation.isPending;
  const showSmartParse = parsed.title.trim().length > 0 && !parsed.dueDate && !parsed.dueTime;

  const handleCreate = () => {
    if (!canCreate) return;
    const dueDate = parsed.dueDate ?? format(selectedDate ?? new Date(), "yyyy-MM-dd");
    createMutation.mutate({
      data: {
        title: parsed.title,
        dueDate,
        priority: (parsed.priority ?? "medium") as any,
        ...(parsed.dueTime ? { dueTime: parsed.dueTime } : {}),
        ...(parsed.category ? { category: parsed.category as any } : {}),
      },
    }, {
      onSuccess: (task) => {
        toast({ title: `Quest added — ${task.points} XP`, className: "border-primary bg-primary/10" });
        setText("");
        setAiFields(null);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
      },
      onError: () => toast({ title: "Couldn't add that quest", variant: "destructive" }),
    });
  };

  const handleSmartParse = () => {
    const requested = text;
    parseMutation.mutate({ data: { text } }, {
      onSuccess: (result) => {
        // Ignore a response for text the user has since edited.
        if (textRef.current !== requested) return;
        setAiFields({
          title: result.title,
          dueDate: result.dueDate ?? undefined,
          dueTime: result.dueTime ?? undefined,
          priority: result.priority ?? undefined,
          category: result.category ?? undefined,
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
          autoFocus
        />
        <Button onClick={handleCreate} disabled={!canCreate} className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0">
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>

      {parsed.title.trim() && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {parsed.dueDate && (
            <span aria-label="Due date" className="px-2 py-0.5 rounded-full border border-border bg-muted/40 flex items-center gap-1">
              <CalendarClock className="w-3 h-3" />
              {dateLabel(parsed.dueDate)}{parsed.dueTime ? ` · ${to12h(parsed.dueTime)}` : ""}
            </span>
          )}
          {!parsed.dueDate && parsed.dueTime && (
            <span aria-label="Due time" className="px-2 py-0.5 rounded-full border border-border bg-muted/40 flex items-center gap-1">
              <CalendarClock className="w-3 h-3" /> {to12h(parsed.dueTime)}
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
            <Button variant="ghost" size="sm" onClick={handleSmartParse} disabled={parseMutation.isPending} className="h-6 px-2 text-xs text-muted-foreground hover:text-primary gap-1">
              {parseMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Smart parse
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
