import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateJson, isAiConfigured, AiClientError } from "./client";

function groqResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isAiConfigured", () => {
  it("reflects presence of GROQ_API_KEY", () => {
    vi.stubEnv("GROQ_API_KEY", "x");
    expect(isAiConfigured()).toBe(true);
    vi.stubEnv("GROQ_API_KEY", "");
    expect(isAiConfigured()).toBe(false);
  });
});

describe("generateJson", () => {
  it("returns the parsed JSON from the model's message content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => groqResponse({ steps: ["a", "b", "c"] })));
    const result = await generateJson("prompt");
    expect(result).toEqual({ steps: ["a", "b", "c"] });
  });

  it("sends the key as a Bearer header, never in the URL", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      groqResponse({ steps: ["a", "b", "c"] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GROQ_API_KEY", "secret-key");
    await generateJson("prompt");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
  });

  it("throws AiClientError when the key is missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
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
