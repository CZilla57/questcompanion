# Voice Input for Quick-Add — Design

## Purpose

Lower friction for capturing quests: let a user speak a quest instead of typing it into the Quick-Add bar, reusing the existing deterministic-parse → Smart-parse (AI) pipeline. Primary driver is ADHD-friendly capture (say it before you lose the thought), not accessibility or hands-free use specifically — though both benefit as a side effect.

## Platform constraint

iPhone/Safari PWA usage is essential for FocusQuest. The free in-browser Web Speech API (`webkitSpeechRecognition`) has poor/no support on iOS Safari, so it's ruled out. Instead: record audio client-side with `MediaRecorder` (supported on iOS Safari 14.3+, including installed PWAs), upload the clip, and transcribe server-side.

## Provider choice

Use Groq's Whisper transcription endpoint (`whisper-large-v3-turbo`), not a new provider. FocusQuest already has `GROQ_API_KEY` configured in prod for LLM quick-add parsing and AI questline generation — this reuses that account and key rather than adding new infrastructure.

## Architecture / flow

1. User taps the mic button in the Quick-Add bar.
2. Browser requests mic permission (if not already granted) and starts `MediaRecorder`, recording webm/opus.
3. UI shows a recording state: pulsing indicator + elapsed time.
4. User taps again to stop (or recording auto-stops at a 60s cap).
5. The recorded blob uploads to a new backend endpoint.
6. Backend forwards the audio to Groq's `audio/transcriptions` endpoint and returns the transcript text.
7. Frontend sets the Quick-Add text field to the transcript, then immediately triggers the existing Smart-parse (AI) step — the same call `handleSmartParse` already makes — since spoken phrasing is more free-form than typed shorthand and benefits from date/priority extraction without an extra tap.
8. From there, the flow is identical to typed input: user reviews the parsed chips, can edit the text, and taps Add (or hits Enter).

## Backend

- New function, e.g. `transcribeAudio()`, added alongside the existing Groq client in `artifacts/api-server/src/lib/ai/client.ts` (or a sibling module in the same directory). Follows the conventions already established there: `AiClientError` for failures, `isAiConfigured()` gate, `AbortSignal.timeout(...)` for request timeout.
- Calls `https://api.groq.com/openai/v1/audio/transcriptions` with `multipart/form-data` (audio blob + `model: whisper-large-v3-turbo`), using `GROQ_API_KEY` for auth — same key as the existing chat-completions calls.
- New route, e.g. `POST /api/tasks/transcribe`. The server's global body parser is `express.json()` only (`artifacts/api-server/src/app.ts`), which can't handle binary bodies, so this route needs its own scoped parser: `express.raw({ type: "audio/webm", limit: "10mb" })`. 10MB comfortably covers well over a minute of spoken audio, safely above the 60s recording cap.
- Rate limiting: reuse the existing `createCooldown` factory (`artifacts/api-server/src/lib/ai/breakdown-cooldown.ts`, already used by `parse-cooldown.ts`) for a per-user transcription cooldown, so repeated taps don't burn Groq quota.
- Error contract matches the existing Smart-parse endpoint exactly, since the frontend already has toast handling for these cases:
  - `503` if `GROQ_API_KEY` is unset (`isAiConfigured()` returns false)
  - `429` if the cooldown hasn't elapsed
  - generic error otherwise (network failure, non-OK response, empty/invalid transcript)

## Frontend

- Mic button added to `artifacts/focusquest/src/components/quick-add-bar.tsx`, next to the existing `Input`.
- Interaction model: tap to start recording, tap again to stop (not hold-to-record).
- Recording state: pulsing indicator + elapsed-time label, replacing or overlaying the mic icon while active.
- On stop: upload the blob via a new generated hook (see Codegen below). On success: `setText(transcript)`, then call the existing `handleSmartParse()` path so the AI parse runs automatically on the transcribed text — mirroring the "auto-run Smart parse" behavior already used for ambiguous typed phrasing.
- If the transcript is empty or whitespace-only: toast "Didn't catch that — try again or type it," leave the text field empty, skip the Smart-parse call.
- If `MediaRecorder` is unsupported, or mic permission is denied: hide the mic button entirely rather than show a broken control. Quick-Add remains fully usable by typing — voice is additive, never a blocker.
- Max recording length: 60 seconds, auto-stopping with a toast if reached, so a forgotten open recording can't run indefinitely.

## Codegen

- Add the `transcribe` operation to `lib/api-spec/openapi.yaml` (request: binary audio body; response: `{ text: string }`, mirroring the shape of the existing `parseQuickAdd` response for `title`-equivalent text).
- Run `orval` (`pnpm --filter @workspace/api-spec codegen`, per the existing `codegen` script) to regenerate `lib/api-client-react` and `lib/api-zod`.
- Frontend uses the generated hook (e.g. `useTranscribeAudio`) rather than a raw `fetch`, matching the existing `useParseQuickAdd` pattern already used in `quick-add-bar.tsx`.

## Explicitly out of scope

- No streaming/live transcription — record a fixed clip, then transcribe (Groq's Whisper endpoint doesn't do incremental streaming, and a fixed-clip flow is simpler to reason about and test).
- No voice input anywhere else in the app (body-doubling rooms, journaling, etc.) — Quick-Add only, per this design's scope.
- No new environment variables or secrets — reuses `GROQ_API_KEY`.
- No changes to the deterministic parser (`@workspace/quick-add`) — voice only changes how text gets into the input field, not how that text is subsequently parsed.
