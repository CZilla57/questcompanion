// Pure helpers for voice quick-add recording. No browser globals here — this
// module must stay testable in the node-env vitest; MediaRecorder access
// lives in use-voice-recording.ts.

export const MAX_RECORDING_MS = 60_000;
export const MIN_RECORDING_MS = 500;

// Order matters: webm/opus is smaller and what Chrome/Firefox produce; iOS
// Safari only supports audio/mp4 (AAC) and will never match the first entry.
const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4"];

export function pickRecordingMimeType(
  isTypeSupported: (type: string) => boolean,
): string | undefined {
  return PREFERRED_MIME_TYPES.find((type) => {
    try {
      return isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

export function isTooShortToTranscribe(durationMs: number): boolean {
  return durationMs < MIN_RECORDING_MS;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
