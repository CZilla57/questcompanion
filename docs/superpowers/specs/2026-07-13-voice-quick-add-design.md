# Voice Input for Quick-Add — Design

## Purpose

Lower friction for capturing quests: let a user speak a quest instead of typing it into the Quick-Add bar, reusing the existing deterministic-parse → Smart-parse (AI) pipeline. Primary driver is ADHD-friendly capture (say it before you lose the thought), not accessibility or hands-free use specifically — though both benefit as a side effect.

## Platform constraint

iPhone/Safari PWA usage is essential for FocusQuest. The free in-browser Web Speech API (`webkitSpeechRecognition`) has poor/no support on iOS Safari, so it's ruled out. Instead: record audio client-side with `MediaRecorder` (supported on iOS Safari 14.3+, including installed PWAs), upload the clip, and transcribe server-side.

Two platform facts drive decisions below:

- **Container varies by browser.** iOS Safari's `MediaRecorder` does not record webm/opus — it produces `audio/mp4` (AAC). Chrome/Android/Firefox produce `audio/webm` (Opus). Groq's Whisper endpoint accepts both containers, so nothing may assume webm: the client probes `MediaRecorder.isTypeSupported()` and the backend accepts either type.
- **`getUserMedia` requires a secure context.** Fine in prod (HTTPS) and on `localhost`, but on-device iPhone testing against a LAN `http://192.168.x.x` dev server won't expose the mic API at all — real-device verification has to go through the deployed HTTPS URL (see Testing).

## Provider choice

Use Groq's Whisper transcription endpoint (`whisper-large-v3-turbo`), not a new provider. FocusQuest already has `GROQ_API_KEY` configured in prod for LLM quick-add parsing and AI questline generation — this reuses that account and key rather than adding new infrastructure.

## Architecture / flow

1. User taps the mic button in the Quick-Add bar.
2. Browser requests mic permission (if not already granted) and starts `MediaRecorder` in the best supported container — probe `MediaRecorder.isTypeSupported()` for `audio/webm;codecs=opus` first, fall back to `audio/mp4` (the iOS Safari path).
3. UI shows a recording state: pulsing indicator + elapsed time.
4. User taps again to stop (or recording auto-stops at a 60s cap).
5. The recorded blob uploads to a new backend endpoint, with the blob's actual MIME type as the request `Content-Type` (so the server knows which container it got).
6. Backend forwards the audio to Groq's `audio/transcriptions` endpoint and returns the transcript text.
7. Frontend sets the Quick-Add text field to the transcript, then immediately triggers the existing Smart-parse (AI) step — the same call `handleSmartParse` already makes — since spoken phrasing is more free-form than typed shorthand and benefits from date/priority extraction without an extra tap. This is cheap even when the transcript didn't need AI: `/tasks/parse` already short-circuits server-side when the deterministic parser resolves a date/time, returning without an LLM call and without consuming the parse cooldown.
8. From there, the flow is identical to typed input: user reviews the parsed chips, can edit the text, and taps Add (or hits Enter).

## Backend

- New function, e.g. `transcribeAudio(audio: Buffer, mimeType: string)`, added as a sibling module next to the existing Groq client in `artifacts/api-server/src/lib/ai/` (keep `client.ts` chat-only). Follows the conventions already established there: `AiClientError` for failures, `isAiConfigured()` gate, `AbortSignal.timeout(...)` for request timeout. The existing 15s timeout is plenty — `whisper-large-v3-turbo` transcribes a 60s clip in about a second; the real budget is the ≤10MB server→Groq upload, which is datacenter-to-datacenter.
- Calls `https://api.groq.com/openai/v1/audio/transcriptions` with `multipart/form-data` via Node's global `FormData`/`Blob` (audio + `model: whisper-large-v3-turbo`, `temperature: 0`), using `GROQ_API_KEY` for auth — same key as the existing chat-completions calls. **The multipart file's filename extension must match the container** (`clip.webm` vs `clip.mp4`, derived from the incoming `Content-Type` with any `;codecs=...` parameters stripped) — Whisper-style endpoints identify the format from the extension, so a mislabeled file fails on exactly one platform and passes tests on the other.
- New route, e.g. `POST /api/tasks/transcribe`. The server's global body parser is `express.json()` only (`artifacts/api-server/src/app.ts`), which ignores non-JSON content types, so this route needs its own scoped parser: `express.raw({ type: ["audio/webm", "audio/mp4"], limit: "10mb" })` (type matching ignores codec parameters, so `audio/webm;codecs=opus` matches fine). 10MB comfortably covers well over a minute of spoken audio in either container, safely above the 60s recording cap, and stays under Groq's 25MB free-tier file limit.
- Rate limiting: new `transcribe-cooldown.ts` mirroring `parse-cooldown.ts` (both are two-liners over the `createCooldown` factory in `artifacts/api-server/src/lib/ai/breakdown-cooldown.ts`), so repeated taps don't burn Groq quota. 5s interval — slightly longer than parse's 3s, since producing a clip takes longer than typing.
- Error contract matches the existing Smart-parse endpoint exactly (`ErrorEnvelope`, i.e. `{ error: string }`), since the frontend already has toast handling for these cases:
  - `401` if unauthenticated (standard route guard)
  - `503` if `GROQ_API_KEY` is unset (`isAiConfigured()` returns false)
  - `429` if the cooldown hasn't elapsed
  - `400` if the body is empty or the `Content-Type` isn't one of the accepted audio types (i.e. `req.body` isn't a non-empty `Buffer` — `express.raw` leaves the body undefined for unmatched types); checked before touching Groq
  - `413` on oversize body — automatic from the `express.raw` limit, but carrying Express's default error body rather than `ErrorEnvelope` (the server has no error-shaping middleware). Acceptable because the 60s cap keeps real clips ~1MB (the limit is unreachable from the app) and the frontend maps unknown statuses to its generic toast.
  - `502` on `AiClientError` (network failure, non-OK Groq response, malformed response body) — same mapping the parse and breakdown routes use

## Frontend

- Mic button added to `artifacts/focusquest/src/components/quick-add-bar.tsx`, next to the existing `Input`. Give it `aria-pressed` + an `aria-label` that flips between "Start voice input" and "Stop recording" so the toggle state is announced.
- Recorder logic lives in a small dedicated hook (e.g. `useVoiceRecording`), keeping the untestable browser calls (`getUserMedia`, `MediaRecorder`) at the edge and the state machine (idle → recording → uploading) unit-testable. `quick-add-bar.tsx` is already ~170 lines; inlining recorder lifecycle would bloat it.
- Interaction model: tap to start recording, tap again to stop (not hold-to-record).
- Recording state: pulsing indicator + elapsed-time label, replacing or overlaying the mic icon while active.
- On stop: upload the blob via a new generated hook (see Codegen below), passing `headers: { "content-type": blob.type }` through the hook's per-call fetch options so the server sees the real container type. On success: `setText(transcript)`, then run the Smart-parse path on the transcribed text — mirroring the "auto-run Smart parse" behavior already used for ambiguous typed phrasing.
  - **Stale-closure gotcha:** `handleSmartParse` as written reads the `text` state and guards stale responses via `textRef` — calling `setText(transcript)` then `handleSmartParse()` synchronously would parse the *pre-transcript* text and then discard the result anyway. Refactor it to accept the text explicitly (e.g. `handleSmartParse(next?: string)` using `next ?? text`, with the stale-response guard comparing against the value actually sent) rather than relying on state having flushed.
- If the transcript is empty or whitespace-only: toast "Didn't catch that — try again or type it," leave the text field empty, skip the Smart-parse call. (Whisper is known to hallucinate short filler like "Thank you." on silence — the empty check plus the minimum-duration guard below keep the worst of that out; don't build heavier filtering in v1.)
- Discard recordings shorter than ~500ms without uploading (treat as an accidental double-tap; show the same "didn't catch that" toast). Saves a Groq call and avoids the silence-hallucination case entirely for stray taps.
- Support detection vs. permission denial are different cases and get different treatment:
  - **Unsupported** (`navigator.mediaDevices?.getUserMedia` or `window.MediaRecorder` absent — old browsers, non-secure contexts): hide the mic button entirely rather than show a broken control. Quick-Add remains fully usable by typing — voice is additive, never a blocker.
  - **Permission denied** (`getUserMedia` rejects with `NotAllowedError`): this is only detectable *after* the user taps, so hiding the button then would make a control vanish under their finger. Keep the button visible and toast "Mic access is blocked — enable it in your browser settings."
- Max recording length: 60 seconds, auto-stopping with a toast if reached, so a forgotten open recording can't run indefinitely.
- Cleanup: stop all `MediaStream` tracks on stop, auto-stop, *and* component unmount — otherwise the browser/OS mic indicator stays lit and iOS keeps the capture session alive. Guard the stop path against double-taps racing the `dataavailable` event (stop must be idempotent).

## Codegen

- Add the `transcribe` operation to `lib/api-spec/openapi.yaml`: request body declared with **both** `audio/webm` and `audio/mp4` content entries (`type: string, format: binary`) so the spec documents the real contract; response `{ text: string }`; error responses (`400`/`429`/`502`/`503`) as `ErrorEnvelope`, mirroring the existing `parseQuickAdd` operation.
- Run `orval` (`pnpm --filter @workspace/api-spec codegen`, per the existing `codegen` script) to regenerate `lib/api-client-react` and `lib/api-zod`.
- Frontend uses the generated hook (e.g. `useTranscribeAudio`) rather than a raw `fetch`, matching the existing `useParseQuickAdd` pattern already used in `quick-add-bar.tsx`. One wrinkle: orval will bake a single `Content-Type` from whichever content entry it picks, but the real type varies at runtime. The generated hooks accept a per-call options object that `customFetch` merges last (`lib/api-client-react/src/custom-fetch.ts`, `mergeHeaders` — later sources win), so passing `headers: { "content-type": blob.type }` at the call site overrides it. Verify the generated signature takes a `Blob` body after codegen; if orval mangles the binary body, fall back to declaring `application/octet-stream` in the spec and adding it to the route's `express.raw` type list.

## Testing

- `transcribeAudio()` unit tests mirror `client.test.ts`: mocked `fetch` covering the happy path (`{ text }` extracted), non-OK status → `AiClientError`, network failure → `AiClientError`, missing key → `AiClientError`, and the filename-extension mapping for both `audio/webm` and `audio/mp4` inputs (including codec-parameter stripping).
- The route itself follows repo convention: routes aren't unit-tested (no supertest infrastructure exists), so all route-level decisions that can be pure functions (content-type → extension mapping, body validation predicates) live in the tested lib, and the route stays a thin status-code dispatcher gated by typecheck.
- Frontend tests: mic button absent when `MediaRecorder`/`mediaDevices` are missing; successful transcript populates the field and triggers Smart-parse with the *transcript* text (regression test for the stale-closure gotcha); empty-transcript and sub-500ms paths toast without uploading. `useVoiceRecording` gets a minimal `MediaRecorder` test double — jsdom has no recording machinery, which is exactly why the hook keeps browser calls at the edge.
- Manual verification must include a real iPhone via the deployed HTTPS URL: the `audio/mp4` path, PWA mic-permission prompts, and mic-indicator release simply cannot be exercised on desktop, and a LAN HTTP dev server isn't a secure context so the mic API won't exist there.

## Explicitly out of scope

- No streaming/live transcription — record a fixed clip, then transcribe (Groq's Whisper endpoint doesn't do incremental streaming, and a fixed-clip flow is simpler to reason about and test).
- No voice input anywhere else in the app (body-doubling rooms, journaling, etc.) — Quick-Add only, per this design's scope.
- No new environment variables or secrets — reuses `GROQ_API_KEY`.
- No changes to the deterministic parser (`@workspace/quick-add`) — voice only changes how text gets into the input field, not how that text is subsequently parsed.
- No Whisper `language` hint or vocabulary-biasing `prompt` parameter — auto-detect is fine for v1, and either would be a one-line addition to `transcribeAudio()` later if transcription quality warrants it.
