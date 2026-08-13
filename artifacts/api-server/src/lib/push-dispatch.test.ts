import { describe, it, expect, vi } from "vitest";
import { sendWebToUser } from "./push-dispatch";

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
