import { describe, it, expect, vi } from "vitest";
import type { TaskInput } from "@workspace/api-client-react";
import { createMemoryStore } from "./store";
import { makeTextEntry, makeVoiceEntry } from "./core";
import { drainOutbox, type ReplayApi } from "./replay";

const key = (n: string) => n.padEnd(12, "_");
const text = (title: string, at: string, extra: Partial<TaskInput> = {}) =>
  makeTextEntry({ title, clientKey: key(title), ...extra }, { now: new Date(at), tz: "UTC" });
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function api(overrides: Partial<ReplayApi> = {}): ReplayApi {
  return {
    createTask: vi.fn().mockResolvedValue({ id: 1 }),
    transcribe: vi.fn().mockResolvedValue({ text: "buy milk" }),
    ...overrides,
  };
}

describe("drainOutbox", () => {
  it("drains oldest-first, passes each entry's id as clientKey, removes synced entries", async () => {
    const store = createMemoryStore();
    await store.add(text("second", "2026-07-20T10:00:00Z"));
    await store.add(text("first", "2026-07-20T09:00:00Z"));
    const a = api();
    const result = await drainOutbox(store, a);
    expect(result).toEqual({ synced: 2, parked: 0, stopped: null });
    const calls = (a.createTask as ReturnType<typeof vi.fn>).mock.calls.map(([input]) => input);
    expect(calls.map((c) => c.title)).toEqual(["first", "second"]);
    expect(calls.map((c) => c.clientKey)).toEqual([key("first"), key("second")]);
    expect(await store.list()).toHaveLength(0);
  });

  it("network failure stops the drain and keeps everything queued, order intact", async () => {
    const store = createMemoryStore();
    await store.add(text("first", "2026-07-20T09:00:00Z"));
    await store.add(text("second", "2026-07-20T10:00:00Z"));
    const a = api({ createTask: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    const result = await drainOutbox(store, a);
    expect(result).toEqual({ synced: 0, parked: 0, stopped: { authNeeded: false } });
    const left = await store.list();
    expect(left).toHaveLength(2);
    expect(left.every((e) => e.status === "queued")).toBe(true);
    expect(left[0].attempts).toBe(1);   // only the attempted head was charged
    expect(left[1].attempts).toBe(0);
    expect(a.createTask).toHaveBeenCalledTimes(1);
  });

  it("401 stops with authNeeded", async () => {
    const store = createMemoryStore();
    await store.add(text("first", "2026-07-20T09:00:00Z"));
    const a = api({ createTask: vi.fn().mockRejectedValue(httpError(401)) });
    const result = await drainOutbox(store, a);
    expect(result.stopped).toEqual({ authNeeded: true });
    expect((await store.list())[0].status).toBe("queued");
  });

  it("429 and 5xx stop the drain (cooldowns / sick server)", async () => {
    for (const status of [429, 500]) {
      const store = createMemoryStore();
      await store.add(text("first", "2026-07-20T09:00:00Z"));
      const result = await drainOutbox(store, api({ createTask: vi.fn().mockRejectedValue(httpError(status)) }));
      expect(result.stopped).toEqual({ authNeeded: false });
    }
  });

  it("422 retries exactly once without questlineId, then succeeds", async () => {
    const store = createMemoryStore();
    await store.add(text("orphan", "2026-07-20T09:00:00Z", { questlineId: 99 }));
    const createTask = vi.fn()
      .mockRejectedValueOnce(httpError(422))
      .mockResolvedValueOnce({ id: 1 });
    const result = await drainOutbox(store, api({ createTask }));
    expect(result).toEqual({ synced: 1, parked: 0, stopped: null });
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(createTask.mock.calls[0][0].questlineId).toBe(99);
    expect(createTask.mock.calls[1][0]).not.toHaveProperty("questlineId");
    expect(createTask.mock.calls[1][0].clientKey).toBe(key("orphan"));
  });

  it("422 with no questline to shed parks the entry and continues", async () => {
    const store = createMemoryStore();
    await store.add(text("bad", "2026-07-20T09:00:00Z"));
    await store.add(text("good", "2026-07-20T10:00:00Z"));
    const createTask = vi.fn()
      .mockRejectedValueOnce(httpError(422))
      .mockResolvedValueOnce({ id: 1 });
    const result = await drainOutbox(store, api({ createTask }));
    expect(result.synced).toBe(1);
    expect(result.parked).toBe(1);
    const left = await store.list();
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe("failed");
    expect(left[0].lastError).toBeTruthy();
  });

  it("terminal 4xx parks the head but still syncs the rest (a bad entry never blocks the queue)", async () => {
    const store = createMemoryStore();
    await store.add(text("bad", "2026-07-20T09:00:00Z"));
    await store.add(text("good", "2026-07-20T10:00:00Z"));
    const createTask = vi.fn()
      .mockRejectedValueOnce(httpError(400))
      .mockResolvedValueOnce({ id: 1 });
    const result = await drainOutbox(store, api({ createTask }));
    expect(result).toEqual({ synced: 1, parked: 1, stopped: null });
    const left = await store.list();
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe("failed");
  });

  it("skips entries already parked as failed", async () => {
    const store = createMemoryStore();
    const parked = text("parked", "2026-07-20T09:00:00Z");
    await store.add(parked);
    await store.update(parked.id, { status: "failed", lastError: "old" });
    await store.add(text("fresh", "2026-07-20T10:00:00Z"));
    const a = api();
    const result = await drainOutbox(store, a);
    expect(result.synced).toBe(1);
    expect(a.createTask).toHaveBeenCalledTimes(1);
    expect((await store.list())[0].status).toBe("failed");
  });

  it("voice: transcribes, parses deterministically anchored to capture time, creates with the entry id", async () => {
    const store = createMemoryStore();
    const blob = new Blob(["x"], { type: "audio/mp4" });
    const entry = makeVoiceEntry(blob, 42_000, { now: new Date("2026-07-20T09:00:00Z"), tz: "UTC" });
    await store.add(entry);
    const a = api({ transcribe: vi.fn().mockResolvedValue({ text: "buy milk" }) });
    const result = await drainOutbox(store, a);
    expect(result.synced).toBe(1);
    expect(a.transcribe).toHaveBeenCalledWith(blob);
    const input = (a.createTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.title).toBe("buy milk");
    expect(input.clientKey).toBe(entry.id);
    expect(input.dueDate).toBe(entry.captureDate);   // no date in transcript → capture day
    expect(input.priority).toBe("medium");
  });

  it("voice: an empty transcript parks with the anti-shame copy and keeps the blob", async () => {
    const store = createMemoryStore();
    await store.add(makeVoiceEntry(new Blob(["x"], { type: "audio/webm" }), 9_000, { now: new Date("2026-07-20T09:00:00Z") }));
    const a = api({ transcribe: vi.fn().mockResolvedValue({ text: "   " }) });
    const result = await drainOutbox(store, a);
    expect(result).toEqual({ synced: 0, parked: 1, stopped: null });
    const [left] = await store.list();
    expect(left.status).toBe("failed");
    expect(left.lastError).toBe("Couldn't hear anything in this note");
    expect(left.payload.kind).toBe("voice");
    expect(a.createTask).not.toHaveBeenCalled();
  });

  it("voice: a transcribe network failure stops the drain with the blob still queued", async () => {
    const store = createMemoryStore();
    await store.add(makeVoiceEntry(new Blob(["x"], { type: "audio/webm" }), 9_000, { now: new Date("2026-07-20T09:00:00Z") }));
    const a = api({ transcribe: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    const result = await drainOutbox(store, a);
    expect(result.stopped).toEqual({ authNeeded: false });
    expect((await store.list())[0].status).toBe("queued");
  });
});
