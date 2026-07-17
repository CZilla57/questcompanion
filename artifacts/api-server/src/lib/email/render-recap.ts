import type { WeekStats } from "@workspace/db";
import { chipLabel } from "../chip-labels";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Label/value stat rows; zero/empty rows are omitted, never rendered as 0
 * (a "0" line is a tiny shame vector). */
function statRows(stats: WeekStats): [string, string][] {
  const rows: [string, string][] = [];
  if (stats.questsCompleted > 0) rows.push(["Quests cleared", String(stats.questsCompleted)]);
  if (stats.focusMinutes > 0) rows.push(["Focused minutes", `${stats.focusMinutes} across ${stats.focusSessions} session${stats.focusSessions === 1 ? "" : "s"}`]);
  if (stats.xpEarned > 0) rows.push(["XP earned", String(stats.xpEarned)]);
  if (stats.coinsEarned > 0) rows.push(["Coins earned", String(stats.coinsEarned)]);
  if (stats.initiations > 0) rows.push(["Times you got started", String(stats.initiations)]);
  if (stats.levelUps > 0) rows.push(["Level-ups", String(stats.levelUps)]);
  if (stats.badges.length > 0) rows.push(["Badges", stats.badges.join(", ")]);
  if (stats.questlinesCompleted.length > 0) rows.push(["Questlines completed", stats.questlinesCompleted.join(", ")]);
  if (stats.boss) {
    rows.push(["World Boss", `${stats.boss.damage} damage in ${stats.boss.attacks} attack${stats.boss.attacks === 1 ? "" : "s"}${stats.boss.defeated ? " — defeated! 🐉" : ""}`]);
  }
  return rows;
}

function rhythmLines(stats: WeekStats): string[] {
  if (!stats.rhythms) return [];
  const lines: string[] = [];
  if (stats.rhythms.powerHours.length > 0) lines.push(`Power hours: ${stats.rhythms.powerHours.map((h) => `${h}:00`).join(", ")}`);
  if (stats.rhythms.bestDay != null) lines.push(`Strongest day: ${DAY_NAMES[stats.rhythms.bestDay]}`);
  if (stats.rhythms.topHelpers.length > 0) lines.push(`What helps you: ${stats.rhythms.topHelpers.map(chipLabel).join(", ")}`);
  return lines;
}

export function renderRecapEmail(
  stats: WeekStats,
  narrative: string,
  unsubscribeUrl: string,
): { html: string; text: string } {
  const rows = statRows(stats);
  const rhythms = rhythmLines(stats);

  const rowsHtml = rows
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 12px 6px 0;color:#a0aec0;font-size:13px;white-space:nowrap;">${esc(label)}</td>
        <td style="padding:6px 0;color:#e2e8f0;font-size:13px;font-weight:600;">${esc(value)}</td>
      </tr>`)
    .join("");

  const rhythmsHtml = rhythms.length > 0
    ? `<p style="margin:18px 0 4px;color:#00ffff;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Your rhythms</p>
       ${rhythms.map((l) => `<p style="margin:4px 0;color:#cbd5e1;font-size:13px;">✨ ${esc(l)}</p>`).join("")}`
    : "";

  const html = `
<div style="background:#0f1420;padding:24px 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#1a2130;border:1px solid #2d3748;border-radius:12px;padding:28px;">
    <p style="margin:0 0 4px;color:#00ffff;font-size:12px;letter-spacing:2px;text-transform:uppercase;">FocusQuest · Weekly Recap</p>
    <h1 style="margin:0 0 16px;color:#f7fafc;font-size:20px;">Your week, adventurer 🗡️</h1>
    <p style="margin:0 0 20px;color:#e2e8f0;font-size:14px;line-height:1.6;">${esc(narrative)}</p>
    <table style="border-collapse:collapse;">${rowsHtml}</table>
    ${rhythmsHtml}
    <hr style="border:none;border-top:1px solid #2d3748;margin:22px 0 14px;" />
    <p style="margin:0;color:#718096;font-size:11px;line-height:1.6;">
      Recaps also live on your <a href="https://getfocusquest.com/insights" style="color:#00ffff;">Insights page</a>.<br />
      <a href="${esc(unsubscribeUrl)}" style="color:#718096;">Unsubscribe from recap emails</a> — one click, no hard feelings.
    </p>
  </div>
</div>`;

  const text = [
    "FocusQuest — Weekly Recap",
    "",
    narrative,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(rhythms.length > 0 ? ["", "Your rhythms:", ...rhythms.map((l) => `- ${l}`)] : []),
    "",
    "Recaps also live on your Insights page: https://getfocusquest.com/insights",
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  return { html, text };
}
