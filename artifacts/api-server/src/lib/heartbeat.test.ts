import { describe, it, expect, vi, afterEach } from "vitest";
import { pingHeartbeat } from "./heartbeat";

afterEach(() => {
  delete process.env.HEARTBEAT_URL;
});

describe("pingHeartbeat", () => {
  it("is a no-op when HEARTBEAT_URL is unset", async () => {
    const fetchFn = vi.fn();
    await expect(pingHeartbeat(fetchFn as unknown as typeof fetch)).resolves.toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("pings the configured URL and reports success", async () => {
    process.env.HEARTBEAT_URL = "https://hc-ping.com/abc";
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    await expect(pingHeartbeat(fetchFn as unknown as typeof fetch)).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("https://hc-ping.com/abc", expect.objectContaining({ method: "GET" }));
  });

  it("swallows network failure — the tick must never die for the monitor", async () => {
    process.env.HEARTBEAT_URL = "https://hc-ping.com/abc";
    const fetchFn = vi.fn().mockRejectedValue(new Error("down"));
    await expect(pingHeartbeat(fetchFn as unknown as typeof fetch)).resolves.toBe(false);
  });

  it("reports false on a non-2xx response", async () => {
    process.env.HEARTBEAT_URL = "https://hc-ping.com/abc";
    const fetchFn = vi.fn().mockResolvedValue({ ok: false });
    await expect(pingHeartbeat(fetchFn as unknown as typeof fetch)).resolves.toBe(false);
  });
});
