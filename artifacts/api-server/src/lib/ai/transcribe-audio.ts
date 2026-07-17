import { AiClientError } from "./client";

/**
 * Voice transcription runs on Groq Whisper independently of the Gemini text
 * provider — this gate must NOT follow isAiConfigured() (client.ts), or a
 * Gemini-only deployment would advertise voice input it can't deliver.
 */
export function isTranscriptionConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

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
