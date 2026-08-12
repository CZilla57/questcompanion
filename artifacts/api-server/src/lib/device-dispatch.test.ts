import { describe, it, expect, vi } from "vitest";
import { dispatchToUser } from "./device-dispatch";

const payload = { title: "T", body: "B" };

function deps(over = {}) {
  return {
    listExpoTokens: vi.fn().mockResolvedValue(["A", "B"]),
    sendExpo: vi.fn().mockResolvedValue([{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }]),
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
    expect(result).toEqual({ webSent: 2, expoSent: 1, pruned: 1 });
  });

  it("skips expo send and prune when the user has no device tokens", async () => {
    const d = deps({ listExpoTokens: vi.fn().mockResolvedValue([]) });
    const result = await dispatchToUser(d, 7, payload);
    expect(d.sendExpo).not.toHaveBeenCalled();
    expect(d.pruneTokens).not.toHaveBeenCalled();
    expect(result).toEqual({ webSent: 2, expoSent: 0, pruned: 0 });
  });
});
