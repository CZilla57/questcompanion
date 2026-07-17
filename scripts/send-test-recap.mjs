// Usage: node scripts/send-test-recap.mjs you@example.com
// Reads RESEND_API_KEY / EMAIL_FROM from repo-root .env.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

const to = process.argv[2];
if (!to) { console.error("Usage: node scripts/send-test-recap.mjs you@example.com"); process.exit(1); }
if (!env.RESEND_API_KEY) { console.error("RESEND_API_KEY missing from .env"); process.exit(1); }

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
  body: JSON.stringify({
    from: env.EMAIL_FROM || "FocusQuest <recap@getfocusquest.com>",
    to: [to],
    subject: "FocusQuest recap smoke test ⚔️",
    html: "<p>If you can read this, Resend + DNS are live.</p>",
    text: "If you can read this, Resend + DNS are live.",
  }),
});
console.log(res.status, await res.text());
