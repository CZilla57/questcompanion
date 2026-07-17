import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isRecapEmailConfigured, sendEmail, EmailError } from "./send-email";

const ENV_KEYS = ["RESEND_API_KEY", "EMAIL_FROM", "GEMINI_API_KEY", "GROQ_API_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("isRecapEmailConfigured", () => {
  it("requires RESEND_API_KEY specifically — AI keys do not enable email", () => {
    expect(isRecapEmailConfigured()).toBe(false);
    process.env.GEMINI_API_KEY = "g";
    process.env.GROQ_API_KEY = "q";
    expect(isRecapEmailConfigured()).toBe(false);
    process.env.RESEND_API_KEY = "re_123";
    expect(isRecapEmailConfigured()).toBe(true);
  });
});

describe("sendEmail", () => {
  it("POSTs the Resend shape with bearer auth and List-Unsubscribe", async () => {
    process.env.RESEND_API_KEY = "re_123";
    process.env.EMAIL_FROM = "FocusQuest <recap@getfocusquest.com>";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "a@b.com", subject: "S", html: "<p>H</p>", text: "T",
      unsubscribeUrl: "https://getfocusquest.com/api/recaps/unsubscribe?token=t1",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_123");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      from: "FocusQuest <recap@getfocusquest.com>",
      to: ["a@b.com"],
      subject: "S",
      html: "<p>H</p>",
      text: "T",
      headers: { "List-Unsubscribe": "<https://getfocusquest.com/api/recaps/unsubscribe?token=t1>" },
    });
  });

  it("throws EmailError on non-2xx and on missing key", async () => {
    await expect(sendEmail({ to: "a@b.com", subject: "S", html: "h", text: "t" }))
      .rejects.toBeInstanceOf(EmailError);

    process.env.RESEND_API_KEY = "re_123";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 422 })));
    await expect(sendEmail({ to: "a@b.com", subject: "S", html: "h", text: "t" }))
      .rejects.toThrow(/422/);
  });
});
