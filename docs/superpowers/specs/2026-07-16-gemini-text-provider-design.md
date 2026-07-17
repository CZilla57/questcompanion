# Gemini as the Text-AI Provider (Voice Stays on Groq Whisper)

**Date:** 2026-07-16
**Status:** Approved
**Motivation:** Better output quality than `llama-3.3-70b-versatile` for the five
text-AI features. Voice transcription stays on Groq Whisper because it is proven
on both recording containers (webm from desktop Chrome, mp4 from iOS Safari),
while Gemini's supported-audio list does not include webm.

## Summary

Swap the backend text-LLM provider from Groq to Gemini using Gemini's
OpenAI-compatible chat-completions endpoint. `generateJson()` in
`artifacts/api-server/src/lib/ai/client.ts` is the single seam for all five text
features (quick-add smart parse, task breakdown, questline quest drafting,
difficulty variants, evening reflection), so the swap is contained to that file
plus the configuration split described below. Voice quick-add transcription
(`transcribe-audio.ts`) keeps calling Groq Whisper unchanged.

> **Amendment (2026-07-16):** the spec originally named gemini-2.5-flash; that model returns 404 ("no longer available to new users") for newly issued API keys. Live-probed and replaced with its GA successor gemini-3.5-flash, verified to honor strict JSON mode with this exact request shape.

> **Amendment 2 (2026-07-16):** live smoke showed gemini-3.5-flash *intermittently* wraps the JSON object in reasoning prose despite `response_format: json_object`. `generateJson` therefore tries strict `JSON.parse(content)` first and, on failure, salvages the first balanced top-level `{…}` block that parses as valid JSON (rescanning past prose brace fragments) before giving up with `AiClientError`. Temperature stays 0.7 (feature variety depends on it); the salvage path is unit-tested and provider-neutral.

> **Amendment 3 (2026-07-16):** the Testing section's route-level pins ("Gemini-only env ⇒ transcribe 503s while parse works", and the reverse) could not be implemented as written — the api-server has no route-test harness (all tests are pure-lib). The invariant is pinned at unit level instead: client.test.ts pins that GROQ_API_KEY alone does not enable isAiConfigured(), and transcribe-audio.test.ts pins that GEMINI_API_KEY alone does not enable isTranscriptionConfigured(). The tasks.ts gate wiring is covered by typecheck, the full suite, and live verification.

## Changes

### 1. `lib/ai/client.ts` — provider swap

- URL: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- Auth: `authorization: Bearer ${GEMINI_API_KEY}` (unchanged header mechanism).
- Model: `process.env.GEMINI_MODEL || "gemini-3.5-flash"`.
- `isAiConfigured()` returns `Boolean(process.env.GEMINI_API_KEY)`.
- `REQUEST_TIMEOUT_MS`: 15_000 → 30_000. Gemini 3.5 Flash performs internal
  "thinking" before responding; small prompts typically return in 2–6 s, but the
  old 15 s ceiling is too tight for the occasional slow response.
- Error strings mention Gemini instead of Groq.
- Everything else byte-identical: JSON mode via `response_format:
  {type: "json_object"}` (supported by Gemini's OpenAI-compat layer),
  `temperature: 0.7`, single user message, same response-envelope parsing
  (`choices[0].message.content` → `JSON.parse`), same `AiClientError` taxonomy.

### 2. `lib/ai/transcribe-audio.ts` — own config gate

- New export `isTranscriptionConfigured(): boolean` returning
  `Boolean(process.env.GROQ_API_KEY)`.
- `transcribeAudio()` and its Groq Whisper endpoint, model, container handling,
  and error strings are untouched.

### 3. `routes/tasks.ts` — transcribe route gate split

The `POST /tasks/transcribe` route currently gates on `isAiConfigured()`. It
switches to `isTranscriptionConfigured()`. Without this, configuring the Gemini
key would flip the transcribe gate green while the actual Whisper call still
requires the Groq key (and vice versa: a Groq-only deployment would 503 voice
even though it works).

All other `isAiConfigured()` call sites (parse, breakdown, difficulty,
questline drafting, reflection ack, momentum struggle-offer) intentionally
follow the new Gemini check with no code change.

### 4. Environment

- `.env.example`: add `GEMINI_API_KEY=` and `GEMINI_MODEL=gemini-3.5-flash`;
  keep `GROQ_API_KEY=` annotated as voice-transcription-only; remove
  `GROQ_MODEL` (no longer read by anything).
- Chad adds the real `GEMINI_API_KEY` to local `.env` and to Render's
  environment. Key values are never handled by the agent.

### 5. Degradation (anti-shame law unchanged)

- No Gemini key → text-AI routes 503 → existing quiet client toasts
  ("Smart parse isn't set up yet.", etc.). Nothing crashes; manual paths work.
- No Groq key → only voice transcription 503s ("Voice input isn't set up
  yet."); all text AI unaffected.

## Testing

- `client.test.ts`: re-stub `GEMINI_API_KEY`/`GEMINI_MODEL`; assert the Gemini
  URL is fetched; existing envelope/error cases carry over.
- `transcribe-audio.test.ts`: keeps `GROQ_API_KEY` stubs; add
  `isTranscriptionConfigured()` cases.
- Route tests: any test that stubs `GROQ_API_KEY` to exercise a *text* feature
  switches to `GEMINI_API_KEY`; transcribe-route tests keep Groq. Add one pin
  each way for the split: Gemini-only env ⇒ transcribe 503s while parse works;
  Groq-only env ⇒ parse 503s while transcribe works.
- Live smoke before PR: with the real key in `.env`, run a one-off script that
  calls `generateJson` against real Gemini and prints the parsed shape
  (no key values in output). Full api-server suite + typecheck as usual.

## Out of Scope

- Moving transcription to Gemini multimodal (webm risk; revisit only if Groq
  becomes a problem).
- Provider-switch abstraction (`AI_PROVIDER` flag) — YAGNI; the single seam
  already makes future swaps a one-file change.
- Prompt tuning for Gemini. Prompts specify their JSON shape explicitly and are
  provider-neutral; if Gemini quality regresses on any feature, that is a
  follow-up.

## Deployment

1. Merge PR (Render auto-deploys `main`).
2. Add `GEMINI_API_KEY` to Render env **before or with** the deploy; until it
   is present, text AI degrades to 503/toasts (acceptable window, no crash).
3. `GROQ_API_KEY` stays configured for voice.
