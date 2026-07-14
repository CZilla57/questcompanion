import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_MS, pickRecordingMimeType } from "@/lib/voice-recording";

export type VoiceRecordingError = "denied" | "failed";

interface UseVoiceRecordingOptions {
  onClip: (blob: Blob, durationMs: number, autoStopped: boolean) => void;
  onError: (kind: VoiceRecordingError) => void;
}

/**
 * Owns the MediaRecorder lifecycle: permission request, container probe,
 * elapsed ticker, the 60s auto-stop cap, and mic release. All mic teardown
 * funnels through one cleanup so the OS recording indicator can't stay lit
 * after stop, auto-stop, or unmount.
 */
export function useVoiceRecording({ onClip, onError }: UseVoiceRecordingOptions) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const autoStoppedRef = useRef(false);
  const timersRef = useRef<{ tick?: number; cap?: number }>({});

  const supported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";

  const cleanup = useCallback(() => {
    window.clearInterval(timersRef.current.tick);
    window.clearTimeout(timersRef.current.cap);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setElapsedMs(0);
  }, []);

  // Release the mic if the component unmounts mid-recording.
  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback((autoStopped = false) => {
    const recorder = recorderRef.current;
    // state check makes stop idempotent against double-taps racing onstop.
    if (!recorder || recorder.state === "inactive") return;
    autoStoppedRef.current = autoStopped;
    recorder.stop(); // fires onstop → clip assembly + cleanup
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return; // already recording

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      onError((err as DOMException)?.name === "NotAllowedError" ? "denied" : "failed");
      return;
    }

    const mimeType = pickRecordingMimeType((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    autoStoppedRef.current = false;
    startedAtRef.current = Date.now();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      // recorder.mimeType is authoritative — the browser may ignore the request.
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      cleanup();
      onClip(blob, durationMs, autoStoppedRef.current);
    };
    recorder.onerror = () => {
      cleanup();
      onError("failed");
    };

    recorder.start();
    setRecording(true);
    setElapsedMs(0);
    timersRef.current.tick = window.setInterval(
      () => setElapsedMs(Date.now() - startedAtRef.current),
      250,
    );
    timersRef.current.cap = window.setTimeout(() => stop(true), MAX_RECORDING_MS);
  }, [cleanup, onClip, onError, stop]);

  return { supported, recording, elapsedMs, start, stop: () => stop(false) };
}
