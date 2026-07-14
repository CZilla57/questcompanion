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
 * after stop, auto-stop, or unmount — including a start() still awaiting
 * permission when the user cancels, double-taps, or navigates away, which
 * is invalidated via a session token checked after the getUserMedia await.
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
  // Bumped to invalidate an in-flight start() (unmount, stop-during-start,
  // or a superseding start) so the awaited stream is released, not leaked.
  const sessionRef = useRef(0);

  const supported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";

  const cleanup = useCallback(() => {
    window.clearInterval(timersRef.current.tick);
    window.clearTimeout(timersRef.current.cap);
    const recorder = recorderRef.current;
    if (recorder) {
      // Detach handlers before stopping tracks — ending tracks can fire a
      // late onstop, which would deliver a phantom clip after cleanup.
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setElapsedMs(0);
  }, []);

  // Release the mic if the component unmounts mid-recording — and cancel a
  // start() still awaiting permission so it can't revive the mic afterwards.
  useEffect(
    () => () => {
      sessionRef.current++;
      cleanup();
    },
    [cleanup],
  );

  const stop = useCallback((autoStopped = false) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      // Nothing recording yet: cancel any start() still awaiting permission.
      sessionRef.current++;
      return;
    }
    autoStoppedRef.current = autoStopped;
    recorder.stop(); // fires onstop → clip assembly + cleanup
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return; // already recording
    const session = ++sessionRef.current;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (sessionRef.current !== session) return; // cancelled while pending
      onError((err as DOMException)?.name === "NotAllowedError" ? "denied" : "failed");
      return;
    }

    // Unmounted, cancelled via stop(), or superseded by a newer start() while
    // permission was pending — release the just-acquired stream, don't leak it.
    if (sessionRef.current !== session || recorderRef.current) {
      stream.getTracks().forEach((track) => track.stop());
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

  const stopRecording = useCallback(() => stop(false), [stop]);

  return { supported, recording, elapsedMs, start, stop: stopRecording };
}
