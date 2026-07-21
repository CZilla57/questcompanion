import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TaskInput } from "@workspace/api-client-react";
import { isNetworkError } from "../net-errors";
import { decideReplayFailure } from "./core";
import { createTaskWithTimeout, transcribeWithTimeout, replayApi } from "./api";

const { createTaskMock, customFetchMock } = vi.hoisted(() => ({
  createTaskMock: vi.fn(),
  customFetchMock: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  createTask: createTaskMock,
  customFetch: customFetchMock,
}));

/** A request that never answers on its own — it only rejects when the caller's
 * timeout signal aborts it, the way fetch behaves against a black hole. */
const hangUntilAbort = (options?: { signal?: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });

const input = { title: "call the vet", clientKey: "vet_________" } as TaskInput & { clientKey: string };

beforeEach(() => {
  vi.useFakeTimers();
  createTaskMock.mockReset();
  customFetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("transcribeWithTimeout", () => {
  it("posts the raw blob with its mime type and an abort signal, clearing the timer on answer", async () => {
    customFetchMock.mockResolvedValue({ text: "buy milk" });
    const blob = new Blob(["x"], { type: "audio/mp4" });
    await expect(transcribeWithTimeout(blob)).resolves.toEqual({ text: "buy milk" });
    expect(customFetchMock).toHaveBeenCalledWith("/api/tasks/transcribe", {
      method: "POST",
      headers: { "content-type": "audio/mp4" },
      body: blob,
      signal: expect.any(AbortSignal),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defaults a typeless blob to audio/webm", async () => {
    customFetchMock.mockResolvedValue({ text: "ok" });
    await transcribeWithTimeout(new Blob(["x"]));
    expect(customFetchMock.mock.calls[0][1].headers).toEqual({ "content-type": "audio/webm" });
  });

  it("aborts a hung request at 30s, and the error reads as a dead zone that stops a drain", async () => {
    customFetchMock.mockImplementation((_url: string, options: { signal?: AbortSignal }) => hangUntilAbort(options));
    const pending = transcribeWithTimeout(new Blob(["x"], { type: "audio/webm" }));
    const outcome = pending.then(
      () => null,
      (err: unknown) => err,
    );
    const signal = customFetchMock.mock.calls[0][1].signal as AbortSignal;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    const err = (await outcome) as { name?: string };
    expect(err?.name).toBe("AbortError");
    // Capture path: quick-add-bar stashes instead of showing a destructive toast.
    expect(isNetworkError(err)).toBe(true);
    // Drain path: clean retryable stop, the entry stays queued for next time.
    expect(decideReplayFailure(err)).toEqual({ action: "stop" });
  });
});

describe("createTaskWithTimeout", () => {
  it("aborts a hung create at 10s with a dead-zone error", async () => {
    createTaskMock.mockImplementation((_input: unknown, options: { signal?: AbortSignal }) => hangUntilAbort(options));
    const pending = createTaskWithTimeout(input);
    const outcome = pending.then(
      () => null,
      (err: unknown) => err,
    );
    const signal = createTaskMock.mock.calls[0][1].signal as AbortSignal;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    const err = (await outcome) as { name?: string };
    expect(err?.name).toBe("AbortError");
    expect(isNetworkError(err)).toBe(true);
  });
});

describe("replayApi", () => {
  it("createTask carries the timeout signal", async () => {
    createTaskMock.mockResolvedValue({ id: 1 });
    await replayApi.createTask(input);
    expect(createTaskMock.mock.calls[0][1].signal).toEqual(expect.any(AbortSignal));
  });

  it("transcribe carries the timeout signal — a hung connection can't wedge the drain lock", async () => {
    customFetchMock.mockResolvedValue({ text: "hi" });
    await replayApi.transcribe(new Blob(["x"], { type: "audio/mp4" }));
    expect(customFetchMock.mock.calls[0][1].signal).toEqual(expect.any(AbortSignal));
  });
});
