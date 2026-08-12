import { describe, it, expect, vi } from "vitest";
import { buildExpoMessages, deadTokensFromReceipts, sendExpoPush } from "./expo-push";

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
