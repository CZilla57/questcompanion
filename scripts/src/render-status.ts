// Reports Render deploys and logs for the questcompanion service. Read-only —
// issues only GETs.
//
//   pnpm --filter @workspace/scripts render-status
//   pnpm --filter @workspace/scripts render-status -- --logs
//   pnpm --filter @workspace/scripts render-status -- --boot
//   pnpm --filter @workspace/scripts render-status -- --logs --text migration
//   pnpm --filter @workspace/scripts render-status -- --logs --since 2h --all
//
//   --logs          recent logs (health checks suppressed; see --all)
//   --boot          logs around the live deploy's start — shows the migration
//                   step and "Server listening"; implies --logs
//   --text <s>      server-side substring filter
//   --since <dur>   lookback window, e.g. 30m, 2h, 1d (default 1h)
//   --all           include /api/healthz + /api/cron/tick request lines
//   --limit <n>     deploys to list (default 5)
//   --log-limit <n> log lines to fetch (default 200)
//
// Logs DO work on Render's free plan (confirmed 2026-07-19). Health checks are
// suppressed by default because cron-job.org pings /api/healthz every ~5s and
// /api/cron/tick every minute, which otherwise buries everything else.
//
// Requires RENDER_API_KEY in .env (see .env.example). Read from the environment
// and never printed — including on error paths.
import fs from "node:fs";
import path from "node:path";

const API = "https://api.render.com/v1";

/** The repo's .env isn't auto-loaded; read it if the var isn't already exported. */
function fromEnvFile(key: string): string | undefined {
  for (const p of [path.resolve("../.env"), path.resolve(".env"), path.resolve("../../.env")]) {
    try {
      const m = fs.readFileSync(p, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
      const v = m?.[1]?.trim().replace(/^["']|["']$/g, "");
      if (v) return v;
    } catch { /* try the next candidate */ }
  }
  return undefined;
}

const KEY = process.env.RENDER_API_KEY || fromEnvFile("RENDER_API_KEY");
if (!KEY) {
  console.error(
    "RENDER_API_KEY is not set.\n" +
    "  1. https://dashboard.render.com/u/settings?add-api-key → Create API Key\n" +
    "     (Account Settings — NOT the service's or workspace's settings)\n" +
    "  2. Add `RENDER_API_KEY=<key>` to .env (gitignored)\n" +
    "Shown in full only once. Do not paste it into a chat or commit it.",
  );
  process.exit(1);
}

async function api<T>(pathname: string): Promise<T> {
  const res = await fetch(`${API}${pathname}`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  // Never echo the key, even here.
  if (!res.ok) throw new Error(`GET ${pathname} → ${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const boot = flag("boot");
const wantLogs = flag("logs") || boot;
const showAll = flag("all");
const text = value("text");
// Kept separate: a small --limit for deploys must not starve the log fetch.
const deployLimit = Number(value("limit")) || 5;
const logLimit = Number(value("log-limit")) || 200;

/** "30m" | "2h" | "1d" → milliseconds. */
function parseSince(s: string | undefined): number {
  if (!s) return 60 * 60 * 1000;
  const m = /^(\d+)([mhd])$/.exec(s.trim());
  if (!m) throw new Error(`--since must look like 30m, 2h or 1d (got "${s}")`);
  const mult = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "m" | "h" | "d"];
  return Number(m[1]) * mult;
}

// ── resolve the service ───────────────────────────────────────────────────
interface Service { id: string; name: string; ownerId: string }
let service: Service;
const configuredId = process.env.RENDER_SERVICE_ID || fromEnvFile("RENDER_SERVICE_ID");

if (configuredId) {
  service = await api<Service>(`/services/${configuredId}`);
} else {
  const all = await api<{ service: Service }[]>("/services?limit=50");
  if (all.length === 0) throw new Error("No services on this Render account.");
  service = (all.find((s) => s.service.name === "questcompanion") ?? all[0]).service;
  if (all.length > 1) console.log(`services: ${all.map((s) => s.service.name).join(", ")}`);
}
console.log(`service: ${service.name} (${service.id})\n`);

// ── deploys ───────────────────────────────────────────────────────────────
interface Deploy {
  id: string; status: string; createdAt: string; finishedAt?: string;
  commit?: { id: string; message: string }; trigger?: string;
}
const deploys = await api<{ deploy: Deploy }[]>(`/services/${service.id}/deploys?limit=${deployLimit}`);

console.log("=== deploys ===");
console.table(deploys.map(({ deploy: d }) => ({
  status: d.status,
  commit: d.commit?.id.slice(0, 7) ?? "—",
  message: (d.commit?.message ?? "").split("\n")[0].slice(0, 50),
  trigger: d.trigger ?? "—",
  created: d.createdAt?.replace("T", " ").slice(0, 19),
  finished: d.finishedAt?.replace("T", " ").slice(0, 19) ?? "—",
})));

if (!wantLogs) process.exit(0);

// ── logs ──────────────────────────────────────────────────────────────────
// --boot windows on the live deploy so the migration step and startup are both
// in range; otherwise look back --since from now.
const live = deploys.find((d) => d.deploy.status === "live")?.deploy;
let startTime: string, endTime: string;
if (boot) {
  if (!live) throw new Error("No live deploy found to window on.");
  // End shortly after the deploy *finished* — the migration step and
  // "Server listening" land right there. A wider window just fills up with
  // ordinary post-boot request traffic.
  const t0 = new Date(live.createdAt).getTime();
  const tEnd = live.finishedAt ? new Date(live.finishedAt).getTime() : t0 + 6 * 60_000;
  startTime = new Date(t0).toISOString();
  endTime = new Date(tEnd + 5_000).toISOString();
  console.log(`\nboot window for ${live.commit?.id.slice(0, 7)} (${startTime} → ${endTime})`);
} else {
  endTime = new Date().toISOString();
  startTime = new Date(Date.now() - parseSince(value("since"))).toISOString();
}

const q = new URLSearchParams({
  ownerId: service.ownerId,
  resource: service.id,
  startTime, endTime,
  limit: String(logLimit),
  // A boot window opens with hundreds of Docker build lines and ends with the
  // part that matters (migrations, "Server listening"), so read from the end.
  direction: boot ? "backward" : "forward",
});
if (text) q.set("text", text);

const res = await api<{ logs: { timestamp: string; message: string }[] }>(`/logs?${q}`);
const logs = boot ? [...(res.logs ?? [])].reverse() : res.logs;

// Health checks and cron ticks dominate the stream; drop them unless --all.
const NOISE = /\/api\/(healthz|cron\/tick)/;
let shown = 0, hidden = 0;

console.log(`\n=== logs (${logs?.length ?? 0} entries) ===`);
for (const l of logs ?? []) {
  if (!showAll && NOISE.test(l.message)) { hidden++; continue; }
  const t = l.timestamp?.replace("T", " ").slice(0, 19);
  // Runtime lines are pino JSON; build/boot lines are plain text.
  let msg = l.message;
  try {
    const j = JSON.parse(msg) as { req?: { method: string; url: string }; res?: { statusCode: number }; msg?: string };
    msg = j.req
      ? `${j.req.method} ${j.req.url} → ${j.res?.statusCode ?? "?"}`
      : (j.msg ?? msg);
  } catch { /* plain text — leave as-is */ }
  console.log(`${t}  ${msg}`);
  shown++;
}
if (!shown) console.log("(nothing matched)");
if (hidden) console.log(`\n(${hidden} health-check/cron lines hidden — pass --all to include)`);
