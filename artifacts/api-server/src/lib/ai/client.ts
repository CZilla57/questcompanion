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
