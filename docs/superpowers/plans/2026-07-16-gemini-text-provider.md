# Gemini Text-AI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the backend text-LLM provider from Groq to Gemini (OpenAI-compatible endpoint); voice transcription stays on Groq Whisper behind its own config gate.

**Architecture:** `generateJson()` in `artifacts/api-server/src/lib/ai/client.ts` is the single seam for all five text-AI features, so the provider swap is a URL/env/model change inside that one function. Transcription (`transcribe-audio.ts`) keeps calling Groq and gains its own `isTranscriptionConfigured()` gate; the transcribe route switches to it so the two keys can't cross-wire.

**Tech Stack:** Node/Express API (`@workspace/api-server`), vitest, Gemini OpenAI-compatible chat completions (`gemini-3.5-flash`), Groq Whisper (`whisper-large-v3-turbo`).

**Spec:** `docs/superpowers/specs/2026-07-16-gemini-text-provider-design.md`

## Global Constraints

- Text-AI env vars: `GEMINI_API_KEY` (required), `GEMINI_MODEL` (optional, default `gemini-3.5-flash`).
- Voice env var: `GROQ_API_KEY` — used ONLY by `transcribe-audio.ts`. `GROQ_MODEL` is retired.
- Gemini endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, Bearer auth, `response_format: {type:"json_object"}`, `temperature: 0.7` — request shape otherwise unchanged from the Groq version.
- Text-call timeout: 30_000 ms (raised from 15_000 — Gemini 3.5 Flash thinks before answering).
- Anti-shame degradation is preserved: missing key ⇒ route returns 503 ⇒ existing client toasts; never crash.
- Never print, log, or commit API key values. The user manages `.env` and Render values.
- All commits on branch `feat/gemini-text-provider`, message style `feat(api): …` / `test(api): …`, each ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Working directory for commands: repo root `C:\Users\Chadr\OneDrive\Documents\Quest-Companion`.

---

### Task 1: Swap `client.ts` to Gemini (TDD)

**Files:**
- Modify: `artifacts/api-server/src/lib/ai/client.test.ts`
- Modify: `artifacts/api-server/src/lib/ai/client.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `isAiConfigured(): boolean` (now keyed on `GEMINI_API_KEY`), `generateJson(prompt: string): Promise<unknown>`, `class AiClientError extends Error` — same exported names and signatures as today; all existing importers compile unchanged.

- [ ] **Step 1: Rewrite the test file to pin Gemini behavior**

Replace the entire contents of `artifacts/api-server/src/lib/ai/client.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateJson, isAiConfigured, AiClientError } from "./client";

function chatResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isAiConfigured", () => {
  it("reflects presence of GEMINI_API_KEY", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    expect(isAiConfigured()).toBe(true);
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(isAiConfigured()).toBe(false);
  });

  it("ignores GROQ_API_KEY — text AI runs on Gemini", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "x");
    expect(isAiConfigured()).toBe(false);
  });
});

describe("generateJson", () => {
  it("returns the parsed JSON from the model's message content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chatResponse({ steps: ["a", "b", "c"] })));
    const result = await generateJson("prompt");
    expect(result).toEqual({ steps: ["a", "b", "c"] });
  });

  it("calls Gemini's OpenAI-compatible endpoint with the default model", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      chatResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generateJson("prompt");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(JSON.parse(init.body as string).model).toBe("gemini-3.5-flash");
  });

  it("honors the GEMINI_MODEL override", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      chatResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash-lite");
    await generateJson("prompt");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body as string).model).toBe("gemini-2.5-flash-lite");
  });

  it("sends the key as a Bearer header, never in the URL", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      chatResponse({ steps: ["a", "b", "c"] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GEMINI_API_KEY", "secret-key");
    await generateJson("prompt");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
  });

  it("throws AiClientError when the key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(generateJson("p")).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(generateJson("p")).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError when the message content is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ));
    await expect(generateJson("p")).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError when the 200 response body is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html>proxy error</html>", { status: 200, headers: { "content-type": "text/html" } }),
    ));
    await expect(generateJson("p")).rejects.toBeInstanceOf(AiClientError);
  });
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/ai/client.test.ts`
Expected: FAIL — `isAiConfigured` tests fail (still reads `GROQ_API_KEY`), URL/model tests fail (still Groq URL and `llama-3.3-70b-versatile`).

- [ ] **Step 3: Swap the implementation**

Replace the entire contents of `artifacts/api-server/src/lib/ai/client.ts` with:

```ts
const DEFAULT_MODEL = "gemini-3.5-flash";
// Gemini 3.5 Flash "thinks" before answering; small prompts usually return in
// 2–6 s but the occasional slow response needs more headroom than Groq did.
const REQUEST_TIMEOUT_MS = 30_000;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export class AiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiClientError";
  }
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * The single network seam for text-LLM calls. Sends a prompt to Gemini's
 * OpenAI-compatible chat endpoint in JSON mode and returns the parsed JSON
 * object. The prompt itself specifies the expected JSON shape, so swapping to
 * any other OpenAI-compatible provider is a base-URL + key change in this body.
 *
 * Voice transcription deliberately does NOT live behind this provider — it
 * stays on Groq Whisper (see transcribe-audio.ts and its own config gate).
 */
export async function generateJson(prompt: string): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiClientError("GEMINI_API_KEY is not set");
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  let response: Response;
  try {
    response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Bearer header keeps the key out of URLs and logs.
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new AiClientError(`Gemini request failed: ${(cause as Error).message}`);
  }

  if (!response.ok) {
    throw new AiClientError(`Gemini request returned ${response.status}`);
  }

  let envelope: { choices?: { message?: { content?: string } }[] };
  try {
    envelope = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
  } catch {
    throw new AiClientError("Gemini returned a non-JSON response body");
  }
  const content = envelope?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new AiClientError("Gemini returned no message content");
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new AiClientError("Gemini returned content that was not valid JSON");
  }
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/ai/client.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/ai/client.ts artifacts/api-server/src/lib/ai/client.test.ts
git commit -m "feat(api): swap text-AI provider to Gemini via OpenAI-compatible endpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Transcription config gate + route split + env docs

**Files:**
- Modify: `artifacts/api-server/src/lib/ai/transcribe-audio.test.ts`
- Modify: `artifacts/api-server/src/lib/ai/transcribe-audio.ts`
- Modify: `artifacts/api-server/src/routes/tasks.ts` (import at line 25; gate at ~line 316)
- Modify: `.env.example` (AI section, currently lines 30–37)

**Interfaces:**
- Consumes: nothing from Task 1 (the route file already imports `isAiConfigured` for other gates — that import stays for them).
- Produces: `isTranscriptionConfigured(): boolean` exported from `artifacts/api-server/src/lib/ai/transcribe-audio.ts`.

- [ ] **Step 1: Add failing tests for the new gate**

In `artifacts/api-server/src/lib/ai/transcribe-audio.test.ts`, change the import line (line 2) to:

```ts
import { transcribeAudio, audioExtensionFor, isTranscriptionConfigured } from "./transcribe-audio";
```

and add this describe block after the `audioExtensionFor` block (after line 46):

```ts
describe("isTranscriptionConfigured", () => {
  it("reflects presence of GROQ_API_KEY", () => {
    vi.stubEnv("GROQ_API_KEY", "x");
    expect(isTranscriptionConfigured()).toBe(true);
    vi.stubEnv("GROQ_API_KEY", "");
    expect(isTranscriptionConfigured()).toBe(false);
  });

  it("ignores GEMINI_API_KEY — voice runs on Groq", () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "x");
    expect(isTranscriptionConfigured()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/ai/transcribe-audio.test.ts`
Expected: FAIL — `isTranscriptionConfigured` is not exported.

- [ ] **Step 3: Implement the gate and switch the route**

In `artifacts/api-server/src/lib/ai/transcribe-audio.ts`, add after the imports (below line 5):

```ts
/**
 * Voice transcription runs on Groq Whisper independently of the Gemini text
 * provider — this gate must NOT follow isAiConfigured() (client.ts), or a
 * Gemini-only deployment would advertise voice input it can't deliver.
 */
export function isTranscriptionConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}
```

In `artifacts/api-server/src/routes/tasks.ts`:

1. Line 25, extend the import:

```ts
import { transcribeAudio, audioExtensionFor, isTranscriptionConfigured } from "../lib/ai/transcribe-audio";
```

2. In the `POST /tasks/transcribe` handler (~line 316), change the gate:

```ts
    if (!isTranscriptionConfigured()) {
      res.status(503).json({ error: "Voice transcription is not configured" });
      return;
    }
```

(Only this one call site changes. Every other `isAiConfigured()` in the file guards a text feature and stays.)

- [ ] **Step 4: Run tests and typecheck to verify**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/ai/transcribe-audio.test.ts`
Expected: PASS (16 tests: 5 audioExtensionFor + 2 isTranscriptionConfigured + 9 transcribeAudio).
Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: clean exit.

- [ ] **Step 5: Update `.env.example`**

Replace the current AI block (lines 30–37):

```
# ── AI (Groq) ────────────────────────────────────────────
# Free API key (no credit card) from https://console.groq.com/keys
# When unset, the AI breakdown feature returns 503 and the app runs normally.
GROQ_API_KEY=
# Optional model override (default: llama-3.3-70b-versatile)
GROQ_MODEL=llama-3.3-70b-versatile
```

with:

```
# ── AI — text (Gemini) ───────────────────────────────────
# Free API key from https://aistudio.google.com/apikey
# When unset, text-AI features (smart parse, breakdown, questline drafting,
# difficulty variants, reflection) return 503 and the app runs normally.
GEMINI_API_KEY=
# Optional model override (default: gemini-3.5-flash)
GEMINI_MODEL=gemini-3.5-flash

# ── AI — voice transcription (Groq Whisper) ──────────────
# Free API key (no credit card) from https://console.groq.com/keys
# Used ONLY for voice quick-add transcription. When unset, voice input
# returns 503 and the app runs normally.
GROQ_API_KEY=
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/ai/transcribe-audio.ts artifacts/api-server/src/lib/ai/transcribe-audio.test.ts artifacts/api-server/src/routes/tasks.ts .env.example
git commit -m "feat(api): split transcription config gate from Gemini text provider

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Full gates + live Gemini smoke

**Files:**
- Create (TEMPORARY, never committed): `artifacts/api-server/src/lib/ai/gemini-live-smoke.test.ts`

**Interfaces:**
- Consumes: `generateJson` from Task 1.
- Produces: nothing — verification only.

- [ ] **Step 1: Run the full api-server suite and typecheck**

Run: `pnpm --filter @workspace/api-server run test`
Expected: all tests pass (was 352 before this feature; now a few more).
Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: clean exit.

**Precondition for the remaining steps:** `GEMINI_API_KEY` must be present in the repo-root `.env` (the user adds it). If it is missing, stop and report — do not fabricate a key.

- [ ] **Step 2: Create the temporary live smoke test**

Create `artifacts/api-server/src/lib/ai/gemini-live-smoke.test.ts`:

```ts
// TEMPORARY live smoke — real network call to Gemini. Run explicitly, then
// DELETE this file. Never commit it: with a key in .env it would make the
// regular test suite hit the network.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateJson } from "./client";

// Pull the key/model from the repo-root .env without echoing values anywhere.
const envPath = fileURLToPath(new URL("../../../../../.env", import.meta.url));
const envText = readFileSync(envPath, "utf8");
for (const name of ["GEMINI_API_KEY", "GEMINI_MODEL"]) {
  const m = envText.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (m && m[1].trim()) process.env[name] = m[1].trim();
}

describe.skipIf(!process.env.GEMINI_API_KEY)("gemini live smoke", () => {
  it("returns parseable JSON from the real endpoint", async () => {
    const result = await generateJson(
      'Reply with a JSON object exactly of the form {"ok": true}.',
    );
    expect(result).toMatchObject({ ok: true });
  }, 45_000);
});
```

- [ ] **Step 3: Run the smoke test**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/ai/gemini-live-smoke.test.ts`
Expected: PASS (1 test) — proves key, endpoint, JSON mode, and envelope parsing against real Gemini. If it reports "skipped", the key wasn't found in `.env` — stop and report.

- [ ] **Step 4: Delete the smoke file**

```bash
rm artifacts/api-server/src/lib/ai/gemini-live-smoke.test.ts
git status --porcelain
```

Expected: `git status` shows a clean tree (no stray smoke file, nothing uncommitted).

---

## Post-plan (not agent tasks)

- PR from `feat/gemini-text-provider` → `main`; merge on user approval.
- User adds `GEMINI_API_KEY` to Render env (keep `GROQ_API_KEY`); `GROQ_MODEL` may be deleted from Render.
- After deploy: real-device sanity — smart parse a quest, run a breakdown, record a voice quick-add.
