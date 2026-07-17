import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transcribeAudio, audioExtensionFor, isTranscriptionConfigured } from "./transcribe-audio";
import { AiClientError } from "./client";

function groqTranscription(text: string): Response {
  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const AUDIO = Buffer.from("fake-audio-bytes");

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("audioExtensionFor", () => {
  it("maps audio/webm to webm", () => {
    expect(audioExtensionFor("audio/webm")).toBe("webm");
  });

  it("maps audio/mp4 to mp4", () => {
    expect(audioExtensionFor("audio/mp4")).toBe("mp4");
  });

  it("strips codec parameters before matching", () => {
    expect(audioExtensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtensionFor("audio/mp4; codecs=mp4a.40.2")).toBe("mp4");
  });

  it("is case-insensitive", () => {
    expect(audioExtensionFor("Audio/MP4")).toBe("mp4");
  });

  it("returns null for unsupported or empty types", () => {
    expect(audioExtensionFor("text/plain")).toBeNull();
    expect(audioExtensionFor("audio/ogg")).toBeNull();
    expect(audioExtensionFor("")).toBeNull();
  });
});

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

describe("transcribeAudio", () => {
  it("returns the transcript text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => groqTranscription("buy milk tomorrow")));
    await expect(transcribeAudio(AUDIO, "audio/webm")).resolves.toBe("buy milk tomorrow");
  });

  it("sends a multipart body whose filename extension matches the container", async () => {
    const fetchMock = vi.fn(async () => groqTranscription("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await transcribeAudio(AUDIO, "audio/mp4;codecs=mp4a.40.2");
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    const form = init.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("clip.mp4");
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("temperature")).toBe("0");
  });

  it("names the file clip.webm for webm input", async () => {
    const fetchMock = vi.fn(async () => groqTranscription("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await transcribeAudio(AUDIO, "audio/webm;codecs=opus");
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(((init.body as FormData).get("file") as File).name).toBe("clip.webm");
  });

  it("sends the key as a Bearer header, never in the URL", async () => {
    const fetchMock = vi.fn(async () => groqTranscription("ok"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GROQ_API_KEY", "secret-key");
    await transcribeAudio(AUDIO, "audio/webm");
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
  });

  it("throws AiClientError when the key is missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    await expect(transcribeAudio(AUDIO, "audio/webm")).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError for an unsupported mime type", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(transcribeAudio(AUDIO, "audio/ogg")).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(transcribeAudio(AUDIO, "audio/webm")).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError when the response body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html>proxy error</html>", { status: 200, headers: { "content-type": "text/html" } }),
    ));
    await expect(transcribeAudio(AUDIO, "audio/webm")).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError when the response has no text field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200, headers: { "content-type": "application/json" } }),
    ));
    await expect(transcribeAudio(AUDIO, "audio/webm")).rejects.toBeInstanceOf(AiClientError);
  });
});
