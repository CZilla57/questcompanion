# Voice Input for Quick-Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mic button to the Quick-Add bar that records a short voice clip, transcribes it server-side via Groq Whisper, and feeds the transcript through the existing Smart-parse pipeline.

**Architecture:** Client records with `MediaRecorder` (webm/opus on Chrome/Firefox, mp4/AAC on iOS Safari — probed at runtime), uploads the raw blob to a new `POST /api/tasks/transcribe` route, which forwards it to Groq's `audio/transcriptions` endpoint and returns `{ text }`. The frontend drops the transcript into the Quick-Add field and auto-runs the existing Smart-parse call. Spec: `docs/superpowers/specs/2026-07-13-voice-quick-add-design.md`.

**Tech Stack:** Express 5 (scoped `express.raw` body parser), Groq `whisper-large-v3-turbo`, orval codegen (OpenAPI → react-query hooks), vitest (node environment — no jsdom, no route tests; this repo tests pure libs only), React + shadcn/ui.

## Global Constraints

- **Branch:** all work on `feat/voice-quick-add`, branched from `main`. Verify with `git branch --show-current` before every commit (concurrent sessions share this working tree).
- **No new env vars or secrets** — reuse `GROQ_API_KEY` via the existing `isAiConfigured()` gate.
- **Model:** `whisper-large-v3-turbo`. Transcription URL: `https://api.groq.com/openai/v1/audio/transcriptions`.
- **Never hand-edit generated code** (`lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`) — only `pnpm --filter @workspace/api-spec codegen` may touch it.
- **Both audio containers everywhere:** `audio/webm` AND `audio/mp4` must be accepted at every layer (route parser, extension mapping, OpenAPI). iOS Safari cannot produce webm.
- **Repo test convention:** pure lib functions get vitest coverage; Express routes and React components/hooks are typecheck-gated only (there is no supertest/jsdom infrastructure — do not add any).
- **Typecheck gate:** `pnpm typecheck` from repo root. Windows: `LF will be replaced by CRLF` warnings on commit are harmless.
- **Recording limits:** 60s max (auto-stop), <500ms discarded as accidental tap, 10MB server body limit.
- Commit messages follow the repo's conventional style (`feat(api): …`, `feat(web): …`) and end with the Claude co-author trailer.

---

### Task 1: Backend transcription lib (`transcribeAudio` + `audioExtensionFor`)

**Files:**
- Create: `artifacts/api-server/src/lib/ai/transcribe-audio.ts`
- Test: `artifacts/api-server/src/lib/ai/transcribe-audio.test.ts`

**Interfaces:**
- Consumes: `AiClientError` from `./client` (existing).
- Produces: `audioExtensionFor(contentType: string): "webm" | "mp4" | null` and `transcribeAudio(audio: Buffer, mimeType: string): Promise<string>` — Task 2's route imports both.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/ai/transcribe-audio.test.ts`. Conventions mirror the existing `client.test.ts` in the same directory (`vi.stubEnv`, `vi.stubGlobal("fetch", …)`, `Response` objects):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transcribeAudio, audioExtensionFor } from "./transcribe-audio";
import { AiClientError } from "./client";

function groqTranscription(text: string): Response {
  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const AUDIO = Buffer.from("fake-audio-bytes");

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("audioExtensionFor", () => {
  it("maps audio/webm to webm", () => {
    expect(audioExtensionFor("audio/webm")).toBe("webm");
  });

  it("maps audio/mp4 to mp4", () => {
    expect(audioExtensionFor("audio/mp4")).toBe("mp4");
  });

  it("strips codec parameters before matching", () => {
    expect(audioExtensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtensionFor("audio/mp4; codecs=mp4a.40.2")).toBe("mp4");
  });

  it("is case-insensitive", () => {
    expect(audioExtensionFor("Audio/MP4")).toBe("mp4");
  });

  it("returns null for unsupported or empty types", () => {
    expect(audioExtensionFor("text/plain")).toBeNull();
    expect(audioExtensionFor("audio/ogg")).toBeNull();
    expect(audioExtensionFor("")).toBeNull();
  });
});

describe("transcribeAudio", () => {
  it("returns the transcript text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => groqTranscription("buy milk tomorrow")));
    await expect(transcribeAudio(AUDIO, "audio/webm")).resolves.toBe("buy milk tomorrow");
  });

  it("sends a multipart body whose filename extension matches the container", async () => {
    const fetchMock = vi.fn(async () => groqTranscription("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await transcribeAudio(AUDIO, "audio/mp4;codecs=mp4a.40.2");
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const form = init.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("clip.mp4");
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("temperature")).toBe("0");
  });

  it("names the file clip.webm for webm input", async () => {
    const fetchMock = vi.fn(async () => groqTranscription("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await transcribeAudio(AUDIO, "audio/webm;codecs=opus");
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(((init.body as FormData).get("file") as File).name).toBe("clip.webm");
  });

  it("sends the key as a Bearer header, never in the URL", async () => {
    const fetchMock = vi.fn(async () => groqTranscription("ok"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GROQ_API_KEY", "secret-key");
    await transcribeAudio(AUDIO, "audio/webm");
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
  });

  it("throws AiClientError when the key is missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    await expect(transcribeAudio(AUDIO, "audio/webm")).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError for an unsupported mime type", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(transcribeAudio(AUDIO, "audio/ogg")).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(transcribeAudio(AUDIO, "audio/webm")).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError when the response body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html>proxy error</html>", { status: 200, headers: { "content-type": "text/html" } }),
    ));
    await expect(transcribeAudio(AUDIO, "audio/webm")).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError when the response has no text field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200, headers: { "content-type": "application/json" } }),
    ));
    await expect(transcribeAudio(AUDIO, "audio/webm")).rejects.toBeInstanceOf(AiClientError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (repo root): `pnpm --filter @workspace/api-server test -- transcribe-audio`
Expected: FAIL — cannot resolve `./transcribe-audio`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/ai/transcribe-audio.ts`:

```ts
import { AiClientError } from "./client";

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
const REQUEST_TIMEOUT_MS = 15_000;

const EXTENSION_BY_TYPE = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
} as const;

/**
 * Maps an audio Content-Type to the file extension Groq uses to identify the
 * container. Codec parameters (`;codecs=opus`) are stripped first. Returns
 * null for anything that isn't a supported recording container.
 */
export function audioExtensionFor(contentType: string): "webm" | "mp4" | null {
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return EXTENSION_BY_TYPE[mediaType as keyof typeof EXTENSION_BY_TYPE] ?? null;
}

/**
 * Sends a recorded clip to Groq's Whisper endpoint and returns the raw
 * transcript. The multipart filename extension must match the container —
 * Whisper-style endpoints identify the format from it, so a mislabeled file
 * fails on exactly one platform (webm = Chrome/Firefox, mp4 = iOS Safari).
 */
export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AiClientError("GROQ_API_KEY is not set");
  }
  const extension = audioExtensionFor(mimeType);
  if (!extension) {
    throw new AiClientError(`Unsupported audio type: ${mimeType}`);
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), `clip.${extension}`);
  form.append("model", TRANSCRIPTION_MODEL);
  form.append("temperature", "0");

  let response: Response;
  try {
    response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      // Bearer header keeps the key out of URLs and logs. No content-type
      // header — fetch sets the multipart boundary itself.
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new AiClientError(`Groq transcription request failed: ${(cause as Error).message}`);
  }

  if (!response.ok) {
    throw new AiClientError(`Groq transcription returned ${response.status}`);
  }

  let envelope: { text?: unknown };
  try {
    envelope = (await response.json()) as { text?: unknown };
  } catch {
    throw new AiClientError("Groq transcription returned a non-JSON response body");
  }
  if (typeof envelope?.text !== "string") {
    throw new AiClientError("Groq transcription returned no text field");
  }
  return envelope.text;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- transcribe-audio`
Expected: PASS (all ~14 tests).

- [ ] **Step 5: Run the full api-server suite**

Run: `pnpm --filter @workspace/api-server test`
Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/ai/transcribe-audio.ts artifacts/api-server/src/lib/ai/transcribe-audio.test.ts
git commit -m "feat(api): Groq Whisper transcription lib with container-aware filenames"
```

---

### Task 2: Transcribe route + cooldown

**Files:**
- Create: `artifacts/api-server/src/lib/ai/transcribe-cooldown.ts`
- Modify: `artifacts/api-server/src/routes/tasks.ts` (imports at top; new route directly after the `/tasks/parse` handler, which ends near line 379)

**Interfaces:**
- Consumes: `transcribeAudio`, `audioExtensionFor` (Task 1); `createCooldown` from `./breakdown-cooldown`; `isAiConfigured`, `AiClientError` from `../lib/ai/client` (already imported in tasks.ts); `logger` (already imported).
- Produces: `POST /api/tasks/transcribe` — accepts a raw `audio/webm` or `audio/mp4` body, responds `200 { text: string }` or `ErrorEnvelope` (`{ error: string }`) with status 401/400/503/429/502. Task 3's OpenAPI entry documents exactly this contract.

Repo convention: routes are not unit-tested (no supertest infra) — the validation and Groq logic live in the Task 1 lib, which is. This task is typecheck-gated.

- [ ] **Step 1: Create the cooldown**

Create `artifacts/api-server/src/lib/ai/transcribe-cooldown.ts` (mirrors `parse-cooldown.ts`; 5s instead of 3s because producing a clip takes longer than typing):

```ts
import { createCooldown } from "./breakdown-cooldown";

export const TRANSCRIBE_COOLDOWN_MS = 5000;
export const transcribeCooldown = createCooldown(TRANSCRIBE_COOLDOWN_MS);
```

No test file — the factory is already covered by `breakdown-cooldown.test.ts`, and the sibling `parse-cooldown.ts` has no test either.

- [ ] **Step 2: Add the route**

In `artifacts/api-server/src/routes/tasks.ts`:

Change line 1 from:

```ts
import { Router, type IRouter } from "express";
```

to:

```ts
import express, { Router, type IRouter } from "express";
```

Add two imports after the existing `import { parseCooldown } from "../lib/ai/parse-cooldown";` line:

```ts
import { transcribeAudio, audioExtensionFor } from "../lib/ai/transcribe-audio";
import { transcribeCooldown } from "../lib/ai/transcribe-cooldown";
```

Insert directly after the closing `});` of the `router.post("/tasks/parse", …)` handler:

```ts
router.post(
  "/tasks/transcribe",
  // The global parser is express.json() only, which ignores audio bodies —
  // this scoped raw parser fills req.body with a Buffer for the two container
  // types MediaRecorder actually produces (type matching ignores codec params).
  // Oversized bodies get an automatic 413 from the limit.
  express.raw({ type: ["audio/webm", "audio/mp4"], limit: "10mb" }),
  async (req, res): Promise<void> => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
    const userId = req.gameUserId;

    const contentType = req.get("content-type") ?? "";
    // A non-matching content type leaves req.body unparsed, so Buffer.isBuffer
    // doubles as the unsupported-container check.
    if (!audioExtensionFor(contentType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "An audio/webm or audio/mp4 body is required" });
      return;
    }

    if (!isAiConfigured()) {
      res.status(503).json({ error: "Voice transcription is not configured" });
      return;
    }
    if (!transcribeCooldown.tryAcquire(userId)) {
      res.status(429).json({ error: "Slow down a moment before transcribing again." });
      return;
    }

    let text: string;
    try {
      text = await transcribeAudio(req.body, contentType);
    } catch (err) {
      if (err instanceof AiClientError) {
        logger.warn({ err }, "voice transcription failed");
        res.status(502).json({ error: "Couldn't transcribe, try typing it." });
        return;
      }
      throw err;
    }

    // May legitimately be empty (silent clip) — the frontend handles that case.
    res.json({ text });
  },
);
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `pnpm typecheck` (repo root)
Expected: clean.
Run: `pnpm --filter @workspace/api-server test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/lib/ai/transcribe-cooldown.ts artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): POST /tasks/transcribe route with scoped raw parser + cooldown"
```

---

### Task 3: OpenAPI operation + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (path entry after `/tasks/parse`, which ends near line 405; schema after `ParsedQuickAdd`, which ends near line 1841)
- Regenerated (by codegen, never by hand): `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`

**Interfaces:**
- Consumes: the route contract from Task 2.
- Produces: generated `useTranscribeAudio` react-query mutation hook (from `@workspace/api-client-react`) whose mutation variable is the audio `Blob` and whose success payload is `TranscribeResult` (`{ text: string }`). Task 5 consumes this hook.

- [ ] **Step 1: Add the path entry**

In `lib/api-spec/openapi.yaml`, directly after the `/tasks/parse` block (before `/tasks/{id}:`), insert:

```yaml
  /tasks/transcribe:
    post:
      operationId: transcribeAudio
      tags: [tasks]
      summary: Transcribe a short voice clip into Quick-Add text
      requestBody:
        required: true
        content:
          audio/webm:
            schema:
              type: string
              format: binary
          audio/mp4:
            schema:
              type: string
              format: binary
      responses:
        "200":
          description: Transcript (may be empty for silent audio)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/TranscribeResult"
        "400":
          description: Missing or unsupported audio body
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "429":
          description: Cooldown — too many transcription requests
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "502":
          description: Transcription provider failure
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "503":
          description: Voice transcription not configured
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```

- [ ] **Step 2: Add the response schema**

Directly after the `ParsedQuickAdd` schema block in `components.schemas`, insert:

```yaml
    TranscribeResult:
      type: object
      required: [text]
      properties:
        text:
          type: string
```

- [ ] **Step 3: Run codegen**

Run (repo root): `pnpm --filter @workspace/api-spec codegen`
Expected: orval regenerates both client packages, then `typecheck:libs` passes.

- [ ] **Step 4: Verify the generated hook shape**

Open `lib/api-client-react/src/generated/api.ts` and find `transcribeAudio`. Confirm:
1. `useTranscribeAudio` exists and its mutation variable type is `Blob` (orval maps `format: binary` to Blob).
2. The generated fetch call spreads per-call/request `options` **after** its own init (`{ …init, …options }` style), so a caller-supplied `headers` object replaces the baked `Content-Type: audio/webm`. This is what lets Task 5 send the real container type at runtime.

If orval instead generated an unusable body type (e.g. `string`), fall back per spec: change both content entries to a single `application/octet-stream` entry, re-run codegen, and add `"application/octet-stream"` to the route's `express.raw` type list from Task 2. Report which shape was generated.

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(api-spec): transcribeAudio operation + regenerated clients"
```

---

### Task 4: Frontend recording helpers lib

**Files:**
- Create: `artifacts/focusquest/src/lib/voice-recording.ts`
- Test: `artifacts/focusquest/src/lib/voice-recording.test.ts`

**Interfaces:**
- Consumes: nothing (pure module — must stay free of browser globals so it runs in the node-env vitest).
- Produces: `MAX_RECORDING_MS = 60_000`, `MIN_RECORDING_MS = 500`, `pickRecordingMimeType(isTypeSupported: (type: string) => boolean): string | undefined`, `isTooShortToTranscribe(durationMs: number): boolean`, `formatElapsed(ms: number): string`. Tasks 5 and 6 consume all of these.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/focusquest/src/lib/voice-recording.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  pickRecordingMimeType,
  isTooShortToTranscribe,
  formatElapsed,
  MAX_RECORDING_MS,
  MIN_RECORDING_MS,
} from "./voice-recording";

describe("pickRecordingMimeType", () => {
  it("prefers webm/opus when supported (Chrome/Firefox)", () => {
    expect(pickRecordingMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to audio/mp4 when webm is unsupported (iOS Safari)", () => {
    expect(pickRecordingMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
  });

  it("returns undefined when nothing matches, letting MediaRecorder use its default", () => {
    expect(pickRecordingMimeType(() => false)).toBeUndefined();
  });

  it("treats a throwing probe as unsupported", () => {
    expect(pickRecordingMimeType(() => { throw new Error("boom"); })).toBeUndefined();
  });
});

describe("isTooShortToTranscribe", () => {
  it("rejects sub-500ms accidental taps", () => {
    expect(isTooShortToTranscribe(0)).toBe(true);
    expect(isTooShortToTranscribe(MIN_RECORDING_MS - 1)).toBe(true);
  });

  it("accepts clips at or above the minimum", () => {
    expect(isTooShortToTranscribe(MIN_RECORDING_MS)).toBe(false);
    expect(isTooShortToTranscribe(MAX_RECORDING_MS)).toBe(false);
  });
});

describe("formatElapsed", () => {
  it("formats sub-minute times as 0:SS", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_400)).toBe("0:07");
    expect(formatElapsed(59_999)).toBe("0:59");
  });

  it("rolls over to minutes", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/focusquest test -- voice-recording`
Expected: FAIL — cannot resolve `./voice-recording`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/focusquest/src/lib/voice-recording.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/focusquest test -- voice-recording`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/voice-recording.ts artifacts/focusquest/src/lib/voice-recording.test.ts
git commit -m "feat(web): pure voice-recording helpers (mime probe, duration guards, elapsed label)"
```

---

### Task 5: `useVoiceRecording` hook

**Files:**
- Create: `artifacts/focusquest/src/hooks/use-voice-recording.ts`

**Interfaces:**
- Consumes: `MAX_RECORDING_MS`, `pickRecordingMimeType` from `@/lib/voice-recording` (Task 4).
- Produces: `useVoiceRecording(options: { onClip: (blob: Blob, durationMs: number, autoStopped: boolean) => void; onError: (kind: "denied" | "failed") => void }): { supported: boolean; recording: boolean; elapsedMs: number; start: () => Promise<void>; stop: () => void }`. Task 6 consumes this exact shape.

This hook is the browser edge (getUserMedia, MediaRecorder) — per repo convention it has no unit tests (node-env vitest has no DOM); it is typecheck-gated and kept as thin as possible.

- [ ] **Step 1: Write the hook**

Create `artifacts/focusquest/src/hooks/use-voice-recording.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean. (No new tests — browser-edge module, see task preamble.)

- [ ] **Step 3: Commit**

```bash
git add artifacts/focusquest/src/hooks/use-voice-recording.ts
git commit -m "feat(web): useVoiceRecording hook — MediaRecorder lifecycle with mic release"
```

---

### Task 6: Quick-Add bar integration

**Files:**
- Modify: `artifacts/focusquest/src/components/quick-add-bar.tsx`

**Interfaces:**
- Consumes: `useTranscribeAudio` from `@workspace/api-client-react` (Task 3); `useVoiceRecording` from `@/hooks/use-voice-recording` (Task 5); `pickRecordingMimeType`, `isTooShortToTranscribe`, `formatElapsed` from `@/lib/voice-recording` (Task 4).
- Produces: the user-facing feature. No new exports.

Component is typecheck-gated per repo convention (no jsdom). Exact toast copy comes from the spec — use the strings verbatim.

- [ ] **Step 1: Update imports**

In `artifacts/focusquest/src/components/quick-add-bar.tsx`:

Line 1: add `useMemo` is already imported; no change. Line 3: extend the lucide import:

```ts
import { Sparkles, CalendarClock, Zap, Plus, RefreshCw, Mic, Square } from "lucide-react";
```

Line 5: add `useTranscribeAudio` to the `@workspace/api-client-react` import list.

After the existing local imports add:

```ts
import { useVoiceRecording } from "@/hooks/use-voice-recording";
import { pickRecordingMimeType, isTooShortToTranscribe, formatElapsed } from "@/lib/voice-recording";
```

- [ ] **Step 2: Refactor `handleSmartParse` to accept explicit text**

Replace the existing `handleSmartParse` (currently reads the `text` state directly — calling it synchronously after `setText(transcript)` would parse the pre-transcript value and then the `textRef` stale-response guard would discard the correct result):

```ts
const handleSmartParse = (next?: string) => {
  const requested = next ?? text;
  // Keep the stale-response guard in sync when invoked with text that hasn't
  // rendered yet (the voice path calls this in the same tick as setText).
  textRef.current = requested;
  parseMutation.mutate({ data: { text: requested, today: format(new Date(), "yyyy-MM-dd") } }, {
    onSuccess: (result) => {
      // Ignore a response for text the user has since edited.
      if (textRef.current !== requested) return;
      setAiFields({
        title: result.title,
        dueDate: result.dueDate ?? undefined,
        dueTime: result.dueTime ?? undefined,
        priority: result.priority ?? undefined,
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
```

**Also update the Smart-parse button's onClick** — it currently passes the handler directly, which would now receive the click event as `next`:

```tsx
<Button variant="ghost" size="sm" onClick={() => handleSmartParse()} disabled={parseMutation.isPending} className="h-6 px-2 text-xs text-muted-foreground hover:text-primary gap-1">
```

- [ ] **Step 3: Wire up transcription + recording**

Add inside the component, **after the `handleSmartParse` definition** (the `onClip` callback references it — placing it earlier trips no-use-before-define):

```ts
// The container is deterministic per browser (webm on Chrome/Firefox, mp4 on
// iOS Safari), so probe once and bake it into the request headers — the
// per-call options replace orval's hardcoded Content-Type in customFetch.
const recordingContentType = useMemo(
  () =>
    (typeof MediaRecorder !== "undefined" &&
      pickRecordingMimeType((t) => MediaRecorder.isTypeSupported(t))) ||
    "audio/webm",
  [],
);
const transcribeMutation = useTranscribeAudio({
  request: { headers: { "content-type": recordingContentType } },
});

const voice = useVoiceRecording({
  onClip: (blob, durationMs, autoStopped) => {
    if (isTooShortToTranscribe(durationMs)) {
      toast({ title: "Didn't catch that — try again or type it.", variant: "destructive" });
      return;
    }
    if (autoStopped) {
      toast({ title: "Hit the 60-second limit — transcribing what I got." });
    }
    transcribeMutation.mutate({ data: blob }, {
      onSuccess: ({ text: transcript }) => {
        if (!transcript.trim()) {
          toast({ title: "Didn't catch that — try again or type it.", variant: "destructive" });
          return;
        }
        setText(transcript);
        setAiFields(null);
        // Spoken phrasing is free-form — run Smart parse without an extra tap.
        // Cheap even when unneeded: /tasks/parse short-circuits server-side
        // when the deterministic parser already resolved a date/time.
        handleSmartParse(transcript);
      },
      onError: (err: any) => {
        const status = err?.status;
        const msg =
          status === 503 ? "Voice input isn't set up yet."
          : status === 429 ? "Give it a moment and try again."
          : "Couldn't transcribe — try typing it.";
        toast({ title: msg, variant: "destructive" });
      },
    });
  },
  onError: (kind) =>
    toast({
      title:
        kind === "denied"
          ? "Mic access is blocked — enable it in your browser settings."
          : "Couldn't start recording.",
      variant: "destructive",
    }),
});
```

- [ ] **Step 4: Add the mic button**

In the JSX, between the `<Input …/>` and the Add `<Button …>`, insert (hidden entirely when unsupported — old browsers or non-secure contexts; permission denial is handled by the toast above because it's only detectable after a tap):

```tsx
{voice.supported && (
  <Button
    type="button"
    variant="outline"
    onClick={() => (voice.recording ? voice.stop() : voice.start())}
    disabled={transcribeMutation.isPending}
    aria-pressed={voice.recording}
    aria-label={voice.recording ? "Stop recording" : "Start voice input"}
    className={`shrink-0 border-primary/20 ${voice.recording ? "text-destructive" : "text-muted-foreground hover:text-primary"}`}
  >
    {voice.recording ? (
      <span className="flex items-center gap-1">
        <Square className="w-3 h-3 fill-current animate-pulse" />
        <span className="text-xs tabular-nums">{formatElapsed(voice.elapsedMs)}</span>
      </span>
    ) : transcribeMutation.isPending ? (
      <RefreshCw className="w-4 h-4 animate-spin" />
    ) : (
      <Mic className="w-4 h-4" />
    )}
  </Button>
)}
```

- [ ] **Step 5: Typecheck and run the frontend suite**

Run: `pnpm typecheck`
Expected: clean.
Run: `pnpm --filter @workspace/focusquest test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/components/quick-add-bar.tsx
git commit -m "feat(web): mic button in Quick-Add — record, transcribe, auto smart-parse"
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: clean across libs + artifacts.

- [ ] **Step 2: All three test suites**

Run: `pnpm --filter @workspace/api-server test`
Run: `pnpm --filter @workspace/focusquest test`
Run: `pnpm --filter @workspace/quick-add test`
Expected: all pass; report counts.

- [ ] **Step 3: Browser smoke test (desktop path)**

Start the dev preview and verify in the browser pane: mic button renders next to the Quick-Add input; clicking it either starts recording (indicator + elapsed timer appear, second click stops and round-trips a transcript into the field when `GROQ_API_KEY` is set locally) or surfaces the permission-denied toast if the embedded pane can't grant mic access. Console must stay free of errors either way. Screenshot the Quick-Add bar with the mic button visible.

Note: the iOS Safari `audio/mp4` path **cannot** be verified on desktop and LAN HTTP isn't a secure context — flag in the PR that real-iPhone verification via the deployed HTTPS URL is a follow-up step for Chad.

- [ ] **Step 4: Report**

Summarize: test counts, typecheck status, what the smoke test proved, and the iPhone-verification caveat. Do not merge — hand off per superpowers:finishing-a-development-branch.
