// Resend's REST API is a single endpoint; calling it with fetch keeps the
// dependency count at zero (mirrors the Gemini client seam in ai/client.ts).
const RESEND_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_FROM = "FocusQuest <recap@getfocusquest.com>";

export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailError";
  }
}

export function isRecapEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailError("RESEND_API_KEY is not set");

  let response: Response;
  try {
    response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || DEFAULT_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.unsubscribeUrl
          ? { headers: { "List-Unsubscribe": `<${input.unsubscribeUrl}>` } }
          : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new EmailError(`Resend request failed: ${(cause as Error).message}`);
  }
  if (!response.ok) throw new EmailError(`Resend request returned ${response.status}`);
}
