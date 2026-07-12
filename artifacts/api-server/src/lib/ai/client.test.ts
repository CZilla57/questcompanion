import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateJson, isAiConfigured, AiClientError } from "./client";

function geminiResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
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
});

describe("generateJson", () => {
  it("returns the parsed JSON from the model's candidate text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiResponse({ steps: ["a", "b", "c"] })));
    const result = await generateJson("prompt", { type: "object" });
    expect(result).toEqual({ steps: ["a", "b", "c"] });
  });

  it("throws AiClientError when the key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(generateJson("p", {})).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(generateJson("p", {})).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError when the candidate text is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ));
    await expect(generateJson("p", {})).rejects.toBeInstanceOf(AiClientError);
  });
});
