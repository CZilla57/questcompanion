import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGetDopamineRewards } from "@workspace/api-client-react";
import type { DopamineReward } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { X, Shuffle, Coffee } from "lucide-react";

const QUEST_COMPLETED_EVENT = "quest-completed";

export function dispatchQuestCompleted() {
  window.dispatchEvent(new CustomEvent(QUEST_COMPLETED_EVENT));
}

function pickRandom<T>(arr: T[], exclude?: T): T | undefined {
  if (arr.length === 0) return undefined;
  const pool = arr.length > 1 && exclude !== undefined
    ? arr.filter((x) => x !== exclude)
    : arr;
  return pool[Math.floor(Math.random() * pool.length)];
}

const AUTO_DISMISS_MS = 9000;

export function DopamineOverlay() {
  const { data: rewards } = useGetDopamineRewards();
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(false);
  const [current, setCurrent] = useState<DopamineReward | undefined>();
  const [progress, setProgress] = useState(100);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const dismiss = () => {
    setVisible(false);
    setCurrent(undefined);
    setProgress(100);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };

  const startTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startRef.current = performance.now();
    setProgress(100);

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const remaining = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setProgress(remaining);
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
  };

  const show = (reward: DopamineReward) => {
    setCurrent(reward);
    setVisible(true);
    startTimer();
  };

  const handleShuffle = () => {
    if (!rewards?.length) return;
    const next = pickRandom(rewards, current);
    if (next) {
      setCurrent(next);
      startTimer();
    }
  };

  useEffect(() => {
    const handler = () => {
      const list = rewards ?? [];
      if (list.length === 0) {
        if (!shown) {
          setShown(true);
        }
        return;
      }
      const pick = pickRandom(list);
      if (pick) show(pick);
    };
    window.addEventListener(QUEST_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(QUEST_COMPLETED_EVENT, handler);
  });

  if (!visible || !current) return null;

  return createPortal(
    <div
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[min(360px,calc(100vw-2rem))]
                 animate-in slide-in-from-bottom-4 fade-in duration-300"
      role="dialog"
      aria-label="Dopamine reward suggestion"
    >
      <div className="rounded-2xl border border-emerald-400/40 bg-card shadow-[0_0_30px_rgba(52,211,153,0.15)] overflow-hidden">
        {/* Progress bar */}
        <div className="h-0.5 bg-muted">
          <div
            className="h-full bg-emerald-400 transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-emerald-400/15 border border-emerald-400/30 flex items-center justify-center">
                <Coffee className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-emerald-400">
                Quest Complete!
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={dismiss}
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Prompt */}
          <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
            You earned a reward — how about this?
          </p>

          {/* Reward */}
          <p className="text-base font-semibold text-foreground leading-snug mb-4">
            {current.rewardText}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 h-8 bg-emerald-500 hover:bg-emerald-400 text-white text-xs gap-1.5 shadow-[0_0_12px_rgba(52,211,153,0.3)]"
              onClick={dismiss}
            >
              Sounds good!
            </Button>
            {(rewards?.length ?? 0) > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleShuffle}
                className="h-8 px-3 text-xs border-border gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Shuffle className="w-3.5 h-3.5" />
                Shuffle
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
