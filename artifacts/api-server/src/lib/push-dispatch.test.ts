import { describe, it, expect, vi } from "vitest";
import { sendWebToUser } from "./push-dispatch";
import { bestEffortDispatch } from "./push-dispatch";

const payload = { title: "T", body: "B" };
const sub = (endpoint: string) => ({ endpoint, p256dh: "p", auth: "a" });

describe("sendWebToUser", () => {
  it("counts successful sends and prunes nothing when all succeed", async () => {
    const deps = {
      listSubscriptions: vi.fn().mockResolvedValue([sub("e1"), sub("e2")]),
      send: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const n = await sendWebToUser(7, payload, deps);
    expect(n).toBe(2);
    expect(deps.send).toHaveBeenCalledTimes(2);
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it("prunes a failed subscription and excludes it from the count", async () => {
    const deps = {
      listSubscriptions: vi.fn().mockResolvedValue([sub("good"), sub("dead")]),
      send: vi
        .fn()
        .mockImplementation((s: { endpoint: string }) =>
          Promise.resolve(s.endpoint === "good"),
        ),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const n = await sendWebToUser(7, payload, deps);
    expect(n).toBe(1);
    expect(deps.remove).toHaveBeenCalledWith("dead");
    expect(deps.remove).toHaveBeenCalledTimes(1);
  });
});

describe("bestEffortDispatch", () => {
  const dispatchDeps = (over: Record<string, unknown> = {}) => ({
    listExpoTokens: vi.fn().mockResolvedValue([]),
    sendExpo: vi.fn().mockResolvedValue([]),
    pruneTokens: vi.fn().mockResolvedValue(undefined),
    sendWeb: vi.fn().mockResolvedValue(1),
    ...over,
  });

  it("resolves without throwing on success and fans out via sendWeb", async () => {
    const deps = dispatchDeps();
    await expect(bestEffortDispatch(7, payload, deps)).resolves.toBeUndefined();
    expect(deps.sendWeb).toHaveBeenCalledWith(7, payload);
  });

  it("swallows errors from a throwing dep (best-effort contract)", async () => {
    const deps = dispatchDeps({
      sendWeb: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await expect(bestEffortDispatch(7, payload, deps)).resolves.toBeUndefined();
  });
});
