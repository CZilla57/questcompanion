import { BrainMode } from "@workspace/api-client-react";

export interface ModeMeta {
  /** Chip / button label. */
  label: string;
  /** One-liner shown in the chip popover and daily prompt. */
  prompt: string;
  /** Line under the momentum board heading; null renders nothing. */
  flavor: string | null;
}

export const MODE_META: Record<BrainMode, ModeMeta> = {
  [BrainMode.focused]: {
    label: "Focused",
    prompt: "Brain's cooperating — point it at something.",
    flavor: "Focused? Good — here's one that moves the needle.",
  },
  [BrainMode.distracted]: {
    label: "Distracted",
    prompt: "Attention is slippery — tiny wins only.",
    flavor: "Distracted? Tiny wins below.",
  },
  [BrainMode.frozen]: {
    label: "Frozen",
    prompt: "Can't start anything — let's shrink it.",
    flavor: "Frozen is a state, not a verdict. One small step below.",
  },
  [BrainMode.hyperfocus]: {
    label: "Hyperfocus",
    prompt: "Locked in — protect the flow.",
    flavor: "Flow protected — ride the thread you're on.",
  },
  [BrainMode.neutral]: {
    label: "Check in",
    prompt: "How's the brain right now?",
    flavor: null,
  },
};

const PROMPT_KEY = "brainPromptDismissed";

export function promptDismissedToday(todayStr: string, storage: Storage = window.localStorage): boolean {
  return storage.getItem(PROMPT_KEY) === todayStr;
}

export function dismissPromptToday(todayStr: string, storage: Storage = window.localStorage): void {
  storage.setItem(PROMPT_KEY, todayStr);
}
