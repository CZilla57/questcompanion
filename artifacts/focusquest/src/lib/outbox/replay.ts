import { parseQuickAdd } from "@workspace/quick-add";
import type { Task, TaskInput } from "@workspace/api-client-react";
import {
  decideReplayFailure,
  EMPTY_TRANSCRIPT_MESSAGE,
  PARK_MESSAGE,
  type OutboxEntry,
} from "./core";
import type { OutboxStore } from "./store";

export type ReplayApi = {
  createTask(input: TaskInput & { clientKey: string }): Promise<Task>;
  transcribe(blob: Blob): Promise<{ text: string }>;
};

export type DrainResult = {
  synced: number;
  parked: number;
  /** Non-null when the drain halted early on a retryable failure. */
  stopped: null | { authNeeded: boolean };
};

/** Build the create body for a voice entry from its transcript. Deterministic
 * parse only, anchored to capture time — no AI parse on replay (spec §Part 3). */
function voiceInput(entry: OutboxEntry, transcript: string): TaskInput & { clientKey: string } {
  if (entry.payload.kind !== "voice") throw new Error("voiceInput on non-voice entry");
  const parsed = parseQuickAdd(transcript, { now: new Date(entry.createdAt) });
  return {
    title: parsed.title || transcript.trim(),
    dueDate: parsed.dueDate ?? entry.captureDate,
    priority: (parsed.priority ?? "medium") as TaskInput["priority"],
    ...(parsed.dueTime ? { dueTime: parsed.dueTime } : {}),
    ...(parsed.category ? { category: parsed.category as TaskInput["category"] } : {}),
    ...(entry.payload.questlineId != null ? { questlineId: entry.payload.questlineId } : {}),
    clientKey: entry.id,
  };
}

function stripQuestline(input: TaskInput & { clientKey: string }): TaskInput & { clientKey: string } {
  const { questlineId: _dropped, ...rest } = input;
  return rest;
}

/** Sequential oldest-first drain. Retryable failures stop the whole drain so
 * order is preserved across triggers; terminal failures park and continue. */
export async function drainOutbox(store: OutboxStore, api: ReplayApi): Promise<DrainResult> {
  const result: DrainResult = { synced: 0, parked: 0, stopped: null };

  for (const entry of await store.list()) {
    if (entry.status === "failed") continue; // parked: manual retry/discard only

    try {
      await store.update(entry.id, { status: "syncing", attempts: entry.attempts + 1 });

      let input: TaskInput & { clientKey: string };
      if (entry.payload.kind === "text") {
        input = entry.payload.input;
      } else {
        const { text } = await api.transcribe(entry.payload.blob);
        if (!text.trim()) {
          await store.update(entry.id, { status: "failed", lastError: EMPTY_TRANSCRIPT_MESSAGE });
          result.parked++;
          continue;
        }
        input = voiceInput(entry, text);
      }

      try {
        await api.createTask(input);
      } catch (err) {
        // One shed-the-questline retry: the capture outranks its grouping.
        if (decideReplayFailure(err).action === "retry-without-questline" && input.questlineId != null) {
          await api.createTask(stripQuestline(input));
        } else {
          throw err;
        }
      }

      await store.remove(entry.id);
      result.synced++;
    } catch (err) {
      const decision = decideReplayFailure(err);
      const park = decision.action === "park" || decision.action === "retry-without-questline";
      try {
        await store.update(
          entry.id,
          park
            ? { status: "failed", lastError: decision.action === "park" ? decision.message : PARK_MESSAGE }
            : { status: "queued" },
        );
      } catch {
        // The store itself failed while recording the outcome (quota, tx
        // abort). Stop cleanly instead of throwing: the entry stays
        // "syncing", which is not skip-guarded, so the next drain re-attempts
        // it — and the clientKey makes any redundant create a dedupe.
        result.stopped = { authNeeded: false };
        break;
      }
      if (park) {
        result.parked++;
        continue;
      }
      result.stopped = { authNeeded: decision.authNeeded === true };
      break;
    }
  }

  return result;
}

/** Web-Lock-wrapped drain so two tabs don't double-run; the server clientKey
 * is the real exactly-once guarantee, this just avoids wasted requests.
 * Returns null when another tab holds the lock. */
export async function drainOutboxLocked(store: OutboxStore, api: ReplayApi): Promise<DrainResult | null> {
  const locks = (navigator as { locks?: LockManager } | undefined)?.locks;
  if (!locks?.request) return drainOutbox(store, api);
  return locks.request("fq-outbox-replay", { ifAvailable: true }, async (lock) =>
    lock ? drainOutbox(store, api) : null,
  );
}
