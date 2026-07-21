import { createTask, customFetch, type TaskInput, type TranscribeResult } from "@workspace/api-client-react";
import type { ReplayApi } from "./replay";

/** 10s cap: a dead-zone request must fail fast into the outbox instead of
 * hanging the capture moment. If the slow request actually landed, the shared
 * clientKey makes the later replay a dedupe, not a duplicate. */
export function createTaskWithTimeout(
  input: TaskInput & { clientKey: string },
  timeoutMs = 10_000,
): ReturnType<typeof createTask> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return createTask(input, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** 30s cap — looser than create because transcription genuinely takes a while,
 * but bounded because the replay drain awaits this while holding the
 * "fq-outbox-replay" web lock: a hung connection would otherwise turn every
 * "Sync now" into a silent no-op until the browser gives up. An abort has no
 * HTTP status, so both consumers already treat it as a dead zone (stash /
 * clean drain stop), never as a destructive error.
 *
 * orval's generated transcribe hook JSON.stringifies Blob bodies (see the
 * note in quick-add-bar.tsx), so this endpoint always goes through
 * customFetch directly with the raw blob. */
export function transcribeWithTimeout(blob: Blob, timeoutMs = 30_000): Promise<TranscribeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return customFetch<TranscribeResult>("/api/tasks/transcribe", {
    method: "POST",
    headers: { "content-type": blob.type || "audio/webm" },
    body: blob,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

export const replayApi: ReplayApi = {
  createTask: (input) => createTaskWithTimeout(input),
  transcribe: (blob) => transcribeWithTimeout(blob),
};
