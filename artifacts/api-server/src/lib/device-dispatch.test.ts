import { describe, it, expect, vi } from "vitest";
import { dispatchToUser } from "./device-dispatch";

const payload = { title: "T", body: "B" };

function deps(over = {}) {
  return {
    listExpoTokens: vi.fn().mockResolvedValue(["A", "B"]),
    sendExpo: vi.fn().mockResolvedValue([{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }]),
    listApnsTokens: vi.fn().mockResolvedValue([]),
    sendApns: vi.fn().mockResolvedValue([]),
    pruneTokens: vi.fn().mockResolvedValue(undefined),
    sendWeb: vi.fn().mockResolvedValue(2),
    ...over,
  };
}

describe("dispatchToUser", () => {
  it("fans out to web and expo and prunes dead tokens", async () => {
    const d = deps();
    const result = await dispatchToUser(d, 7, payload);
    expect(d.sendWeb).toHaveBeenCalledWith(7, payload);
    expect(d.sendExpo).toHaveBeenCalledWith(["A", "B"], payload);
    expect(d.pruneTokens).toHaveBeenCalledWith(["B"]);
    expect(result).toEqual({ webSent: 2, expoSent: 1, apnsSent: 0, pruned: 1 });
  });

  it("skips expo send and prune when the user has no device tokens", async () => {
    const d = deps({ listExpoTokens: vi.fn().mockResolvedValue([]) });
    const result = await dispatchToUser(d, 7, payload);
    expect(d.sendExpo).not.toHaveBeenCalled();
    expect(d.pruneTokens).not.toHaveBeenCalled();
    expect(result).toEqual({ webSent: 2, expoSent: 0, apnsSent: 0, pruned: 0 });
  });

  it("dispatches to APNs tokens and prunes dead ones", async () => {
    const pruned: string[] = [];
    const deps = {
      sendWeb: async () => 0,
      listExpoTokens: async () => [],
      sendExpo: async () => [],
      listApnsTokens: async () => [
        { token: "APN_A", environment: null },
        { token: "APN_B", environment: "sandbox" as const },
      ],
      sendApns: async () => [{ status: "ok" as const }, { status: "error" as const, reason: "Unregistered" }],
      pruneTokens: async (t: string[]) => { pruned.push(...t); },
    };
    const result = await dispatchToUser(deps, 1, { title: "T", body: "B" });
    expect(result.apnsSent).toBe(1);
    expect(pruned).toEqual(["APN_B"]);
  });
});
