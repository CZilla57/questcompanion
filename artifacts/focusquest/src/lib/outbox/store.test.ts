import { describe, it, expect, vi } from "vitest";
import { createMemoryStore, outboxChanged } from "./store";
import { makeTextEntry } from "./core";

const entry = (key: string, at: string) =>
  makeTextEntry({ title: key, clientKey: key.padEnd(12, "_") }, { now: new Date(at), tz: "UTC" });

describe("memory OutboxStore (contract for both adapters)", () => {
  it("is honest about persistence", () => {
    expect(createMemoryStore().persistent).toBe(false);
  });

  it("lists in createdAt order regardless of insertion order", async () => {
    const s = createMemoryStore();
    await s.add(entry("second", "2026-07-20T10:00:00Z"));
    await s.add(entry("first", "2026-07-20T09:00:00Z"));
    await s.add(entry("third", "2026-07-20T11:00:00Z"));
    const titles = (await s.list()).map((e) => e.payload.kind === "text" && e.payload.input.title);
    expect(titles).toEqual(["first", "second", "third"]);
  });

  it("update patches in place and ignores unknown ids", async () => {
    const s = createMemoryStore();
    const e = entry("a", "2026-07-20T09:00:00Z");
    await s.add(e);
    await s.update(e.id, { status: "failed", lastError: "nope", attempts: 3 });
    await s.update("missing-id___", { status: "failed" });
    const [got] = await s.list();
    expect(got.status).toBe("failed");
    expect(got.lastError).toBe("nope");
    expect(got.attempts).toBe(3);
  });

  it("remove deletes exactly one entry", async () => {
    const s = createMemoryStore();
    const a = entry("a", "2026-07-20T09:00:00Z");
    const b = entry("b", "2026-07-20T10:00:00Z");
    await s.add(a);
    await s.add(b);
    await s.remove(a.id);
    const left = await s.list();
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(b.id);
  });

  it("emits a change event on add/update/remove", async () => {
    const s = createMemoryStore();
    const spy = vi.fn();
    outboxChanged.addEventListener("change", spy);
    const e = entry("a", "2026-07-20T09:00:00Z");
    await s.add(e);
    await s.update(e.id, { attempts: 1 });
    await s.remove(e.id);
    outboxChanged.removeEventListener("change", spy);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
