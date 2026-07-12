const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const REQUEST_TIMEOUT_MS = 15_000;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export class AiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiClientError";
  }
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

/**
 * The single network seam for LLM calls. Sends a prompt to Groq's
 * OpenAI-compatible chat endpoint in JSON mode and returns the parsed JSON
 * object. The prompt itself specifies the expected JSON shape, so swapping to
 * any other OpenAI-compatible provider is a base-URL + key change in this body.
 */
export async function generateJson(prompt: string): Promise<unknown> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AiClientError("GROQ_API_KEY is not set");
  }
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;

  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
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
    throw new AiClientError(`Groq request failed: ${(cause as Error).message}`);
  }

  if (!response.ok) {
    throw new AiClientError(`Groq request returned ${response.status}`);
  }

  let envelope: { choices?: { message?: { content?: string } }[] };
  try {
    envelope = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
  } catch {
    throw new AiClientError("Groq returned a non-JSON response body");
  }
  const content = envelope?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new AiClientError("Groq returned no message content");
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new AiClientError("Groq returned content that was not valid JSON");
  }
}
