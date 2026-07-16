import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMysteryBox,
  getGetMysteryBoxQueryKey,
  useOpenMysteryBox,
  useGetDopamineRewards,
  getGetCoinsQueryKey,
} from "@workspace/api-client-react";
import type { MysteryResult } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { Coins, Sparkles, Gift, X } from "lucide-react";

// Minimum slot-machine spin before landing on the reward, so a fast request still
// feels like a deliberate reveal (skipped entirely under reduced-motion).
const MIN_SPIN_MS = 1100;
const SPIN_TICK_MS = 80;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

type Phase = "idle" | "spinning" | "revealed";

export function MysteryBox() {
  const { data: status } = useGetMysteryBox();
  const { data: rewards = [] } = useGetDopamineRewards();
  const openMutation = useOpenMysteryBox();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("idle");
  const [spinText, setSpinText] = useState("");
  const [result, setResult] = useState<MysteryResult | null>(null);

  const spinRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const landRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cost = status?.cost ?? 15;
  const reason = status?.reason ?? "ok";
  const remaining = status?.remaining ?? 0;
  const canOpen = status?.canOpen ?? false;

  const clearTimers = () => {
    if (spinRef.current) { clearInterval(spinRef.current); spinRef.current = null; }
    if (landRef.current) { clearTimeout(landRef.current); landRef.current = null; }
  };
  useEffect(() => clearTimers, []);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetMysteryBoxQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
  };

  const startSpin = () => {
    const pool = rewards.map((r) => r.rewardText);
    if (pool.length === 0) return;
    let i = 0;
    setSpinText(pool[0]!);
    spinRef.current = setInterval(() => {
      i = (i + 1) % pool.length;
      setSpinText(pool[i]!);
    }, SPIN_TICK_MS);
  };

  const finishReveal = (res: MysteryResult) => {
    clearTimers();
    invalidate();
    if (!res.opened) {
      // A gentle race outcome (drained or emptied between status load and click).
      setPhase("idle");
      toast({
        title: res.reason === "no_rewards"
          ? "Add a reward to your menu first"
          : `${res.remaining ?? 0} more to go`,
      });
      return;
    }
    setResult(res);
    setPhase("revealed");
  };

  const handleOpen = () => {
    if (phase !== "idle" || !canOpen) return;
    setResult(null);

    if (prefersReducedMotion()) {
      setPhase("spinning");
      openMutation.mutate(undefined, {
        onSuccess: finishReveal,
        onError: (err) => { setPhase("idle"); toast({ title: apiErrorMessage(err, "Couldn't open the box"), variant: "destructive" }); },
      });
      return;
    }

    setPhase("spinning");
    startSpin();
    const started = performance.now();
    openMutation.mutate(undefined, {
      onSuccess: (res) => {
        const wait = Math.max(0, MIN_SPIN_MS - (performance.now() - started));
        landRef.current = setTimeout(() => finishReveal(res), wait);
      },
      onError: (err) => {
        clearTimers();
        setPhase("idle");
        toast({ title: apiErrorMessage(err, "Couldn't open the box"), variant: "destructive" });
      },
    });
  };

  const dismiss = () => {
    clearTimers();
    setPhase("idle");
    setResult(null);
  };

  return (
    <>
      {/* Card */}
      <div className="rounded-xl border border-violet-400/30 bg-gradient-to-br from-violet-500/10 to-amber-400/5 p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-400/15 border border-violet-400/30 flex items-center justify-center shrink-0">
            <Gift className="w-5 h-5 text-violet-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              Mystery Box
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Spend coins for a surprise reward from your menu — with a chance of coins back.
            </p>

            <div className="mt-3">
              {reason === "no_rewards" ? (
                <p className="text-xs text-muted-foreground/80">
                  Add a reward below to unlock the Mystery Box.
                </p>
              ) : reason === "insufficient" ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled className="bg-muted text-muted-foreground cursor-not-allowed">
                    <Coins className="w-3.5 h-3.5 mr-1.5" />
                    Open · {cost}
                  </Button>
                  <span className="text-xs text-amber-300/90 tabular-nums">{remaining} more to go</span>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={handleOpen}
                  disabled={phase !== "idle" || openMutation.isPending}
                  className="bg-violet-500 hover:bg-violet-500/90 text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
                >
                  <Coins className="w-3.5 h-3.5 mr-1.5" />
                  {phase !== "idle" ? "Opening…" : `Open · ${cost}`}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reveal overlay */}
      {phase !== "idle" && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/70 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-label="Mystery Box reveal"
          onClick={phase === "revealed" ? dismiss : undefined}
        >
          <div
            className="relative w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-violet-400/40 bg-card shadow-[0_0_40px_rgba(139,92,246,0.25)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {phase === "revealed" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={dismiss}
                className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-foreground z-10"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}

            <div className="p-6 text-center">
              <div className="flex items-center justify-center gap-2 mb-4">
                <Gift className="w-4 h-4 text-violet-300" />
                <span className="text-xs font-bold uppercase tracking-[0.15em] text-violet-300">
                  Mystery Box
                </span>
              </div>

              {phase === "spinning" ? (
                <div className="h-16 flex items-center justify-center">
                  <motion.p
                    key={spinText}
                    initial={{ y: -12, opacity: 0.2 }}
                    animate={{ y: 0, opacity: 0.6 }}
                    transition={{ duration: SPIN_TICK_MS / 1000 }}
                    className="text-base font-semibold text-foreground blur-[0.4px] select-none"
                  >
                    {spinText || "…"}
                  </motion.p>
                </div>
              ) : result?.reward ? (
                <div className="min-h-16 flex flex-col items-center justify-center">
                  <motion.p
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 320, damping: 18 }}
                    className="text-lg font-bold text-foreground leading-snug"
                  >
                    {result.reward.rewardText}
                  </motion.p>
                  <p className="text-[11px] text-muted-foreground mt-1">Enjoy it — you earned it. 🎉</p>
                </div>
              ) : null}

              <AnimatePresence>
                {phase === "revealed" && (result?.bonus ?? 0) > 0 && (
                  <motion.div
                    initial={{ y: 8, opacity: 0, scale: 0.8 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    transition={{ delay: 0.25, type: "spring", stiffness: 300, damping: 16 }}
                    className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-400/40 bg-amber-400/10 text-amber-300"
                  >
                    <Coins className="w-3.5 h-3.5" />
                    <span className="text-sm font-semibold tabular-nums">
                      +{result?.bonus} bonus{result?.bonus === cost ? " — free pull!" : ""}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {phase === "revealed" && (
                <Button
                  onClick={dismiss}
                  className="mt-6 w-full bg-violet-500 hover:bg-violet-500/90 text-white"
                >
                  Nice!
                </Button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
