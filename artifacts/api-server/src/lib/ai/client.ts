const DEFAULT_MODEL = "gemini-2.0-flash";
const REQUEST_TIMEOUT_MS = 15_000;

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
 * The single network seam for LLM calls. Sends a prompt to the Gemini REST API
 * with a JSON responseSchema and returns the parsed JSON object. Swapping to
 * another provider means replacing only this function's body.
 */
export async function generateJson(
  prompt: string,
  responseSchema: Record<string, unknown>,
): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiClientError("GEMINI_API_KEY is not set");
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Header (not query string) keeps the key out of URLs and logs.
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
          temperature: 0.7,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new AiClientError(`Gemini request failed: ${(cause as Error).message}`);
  }

  if (!response.ok) {
    throw new AiClientError(`Gemini request returned ${response.status}`);
  }

  let envelope: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  try {
    envelope = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
  } catch {
    throw new AiClientError("Gemini returned a non-JSON response body");
  }
  const text = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new AiClientError("Gemini returned no candidate text");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AiClientError("Gemini returned text that was not valid JSON");
  }
}
