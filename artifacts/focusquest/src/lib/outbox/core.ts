import type { TaskInput } from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";

export type TextPayload = {
  kind: "text";
  /** The fully resolved create body from QuickAddBar at capture time. */
  input: TaskInput & { clientKey: string };
};

export type VoicePayload = {
  kind: "voice";
  /** Mime preserved via blob.type — iOS records audio/mp4, not webm. */
  blob: Blob;
  durationMs: number;
  questlineId?: number;
};

export type OutboxStatus = "queued" | "syncing" | "failed";

export type OutboxEntry = {
  /** INVARIANT: doubles as the server clientKey — same UUID from first
   * attempt through every replay, which is what makes replays exactly-once. */
  id: string;
  createdAt: string;
  /** YYYY-MM-DD in the device's local tz at capture — replay's dueDate default. */
  captureDate: string;
  tz: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  payload: TextPayload | VoicePayload;
};

export const EMPTY_TRANSCRIPT_MESSAGE = "Couldn't hear anything in this note";
const PARK_MESSAGE = "Couldn't sync this one — retry or discard.";

export function newCaptureId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (!c) {
    // No Web Crypto at all — unreachable in our targets (Node >=19, evergreen
    // + old WebKit all expose crypto). Last-ditch non-crypto id: a capture
    // must never be lost to an exotic runtime.
    return `fallback-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  }
  // Old-WebKit fallback (crypto present, randomUUID missing): RFC4122-v4-shaped.
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function localDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

type EntryOpts = { now?: Date; tz?: string };

function baseEntry(id: string, opts?: EntryOpts) {
  const now = opts?.now ?? new Date();
  return {
    id,
    createdAt: now.toISOString(),
    captureDate: localDateString(now),
    tz: opts?.tz ?? browserTimeZone(),
    status: "queued" as const,
    attempts: 0,
  };
}

export function makeTextEntry(input: TaskInput & { clientKey: string }, opts?: EntryOpts): OutboxEntry {
  const base = baseEntry(input.clientKey, opts);
  return {
    ...base,
    // A capture never loses the day the thought happened.
    payload: { kind: "text", input: { ...input, dueDate: input.dueDate ?? base.captureDate } },
  };
}

export function makeVoiceEntry(
  blob: Blob,
  durationMs: number,
  opts?: EntryOpts & { questlineId?: number },
): OutboxEntry {
  return {
    ...baseEntry(newCaptureId(), opts),
    payload: {
      kind: "voice",
      blob,
      durationMs,
      ...(opts?.questlineId != null ? { questlineId: opts.questlineId } : {}),
    },
  };
}

export type ReplayFailureDecision =
  | { action: "stop"; authNeeded?: boolean }
  | { action: "park"; message: string }
  | { action: "retry-without-questline" };

/** The drain policy table (spec §Part 3). Retryable failures stop the whole
 * drain so order is preserved; only a terminal 4xx parks the entry. */
export function decideReplayFailure(err: unknown): ReplayFailureDecision {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return { action: "stop" };
  if (status === 401) return { action: "stop", authNeeded: true };
  if (status === 429 || status >= 500) return { action: "stop" };
  if (status === 422) return { action: "retry-without-questline" };
  return { action: "park", message: PARK_MESSAGE };
}

export function entryLabel(e: OutboxEntry): string {
  if (e.payload.kind === "text") return e.payload.input.title;
  const s = Math.round(e.payload.durationMs / 1000);
  return `Voice note · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
