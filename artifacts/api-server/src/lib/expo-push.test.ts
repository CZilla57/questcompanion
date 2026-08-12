import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildExpoMessages,
  deadTokensFromReceipts,
  sendExpoPush,
  expoHttpTransport,
} from "./expo-push";

const payload = { title: "T", body: "B", data: { url: "/focus" } };

describe("buildExpoMessages", () => {
  it("maps each token to an Expo message with title/body/data", () => {
    expect(buildExpoMessages(["ExpoTok[A]", "ExpoTok[B]"], payload)).toEqual([
      { to: "ExpoTok[A]", title: "T", body: "B", data: { url: "/focus" } },
      { to: "ExpoTok[B]", title: "T", body: "B", data: { url: "/focus" } },
    ]);
  });

  it("returns an empty array for no tokens", () => {
    expect(buildExpoMessages([], payload)).toEqual([]);
  });
});

describe("deadTokensFromReceipts", () => {
  it("returns only tokens whose receipt is DeviceNotRegistered", () => {
    const receipts = [
      { status: "ok" as const },
      { status: "error" as const, details: { error: "DeviceNotRegistered" } },
    ];
    expect(deadTokensFromReceipts(["A", "B"], receipts)).toEqual(["B"]);
  });
});

describe("sendExpoPush", () => {
  it("delegates to the injected transport and returns its receipts", async () => {
    const transport = vi.fn().mockResolvedValue([{ status: "ok" }]);
    const messages = buildExpoMessages(["A"], payload);
    const receipts = await sendExpoPush(messages, transport);
    expect(transport).toHaveBeenCalledWith(messages);
    expect(receipts).toEqual([{ status: "ok" }]);
  });

  it("does not call the transport when there are no messages", async () => {
    const transport = vi.fn();
    expect(await sendExpoPush([], transport)).toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("expoHttpTransport", () => {
  const batch = buildExpoMessages(["A", "B"], payload);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: () => Promise<Response> | Response) {
    vi.stubGlobal("fetch", vi.fn(impl));
  }

  it("returns Expo's receipts on a successful response", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ status: "ok" }, { status: "ok" }] }), {
          status: 200,
        }),
      ),
    );
    expect(await expoHttpTransport(batch)).toEqual([{ status: "ok" }, { status: "ok" }]);
  });

  it("maps a non-2xx response to one error receipt per message", async () => {
    stubFetch(() => Promise.resolve(new Response("rate limited", { status: 429 })));
    expect(await expoHttpTransport(batch)).toEqual([
      { status: "error", details: { error: "HTTP 429" } },
      { status: "error", details: { error: "HTTP 429" } },
    ]);
  });

  it("maps a network failure to error receipts instead of throwing", async () => {
    stubFetch(() => Promise.reject(new Error("ECONNRESET")));
    expect(await expoHttpTransport(batch)).toEqual([
      { status: "error", details: { error: "RequestFailed" } },
      { status: "error", details: { error: "RequestFailed" } },
    ]);
  });

  it("maps an unparseable body to error receipts", async () => {
    stubFetch(() => Promise.resolve(new Response("not json", { status: 200 })));
    expect(await expoHttpTransport(batch)).toEqual([
      { status: "error", details: { error: "InvalidResponse" } },
      { status: "error", details: { error: "InvalidResponse" } },
    ]);
  });

  it("falls back to NoReceipt when the body has no data array", async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ errors: [] }), { status: 200 })),
    );
    expect(await expoHttpTransport(batch)).toEqual([
      { status: "error", details: { error: "NoReceipt" } },
      { status: "error", details: { error: "NoReceipt" } },
    ]);
  });
});
