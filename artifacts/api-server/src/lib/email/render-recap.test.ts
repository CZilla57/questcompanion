import { describe, it, expect } from "vitest";
import { renderRecapEmail } from "./render-recap";
import type { WeekStats } from "@workspace/db";

function stats(overrides: Partial<WeekStats> = {}): WeekStats {
  return {
    weekKey: "2026-W29",
    questsCompleted: 3,
    sampleQuestTitles: ["Fold laundry"],
    focusSessions: 2,
    focusMinutes: 45,
    xpEarned: 120,
    coinsEarned: 0,
    initiations: 4,
    levelUps: 0,
    badges: [],
    questlinesCompleted: [],
    boss: { damage: 40, attacks: 3, defeated: true },
    rhythms: { powerHours: [9, 14], bestDay: 2, topHelpers: ["timer"] },
    ...overrides,
  };
}

describe("renderRecapEmail", () => {
  it("carries narrative, stats, and the unsubscribe link in both parts", () => {
    const { html, text } = renderRecapEmail(stats(), "A good week.", "https://x.test/u?token=t1");
    for (const part of [html, text]) {
      expect(part).toContain("A good week.");
      expect(part).toContain("45");           // focus minutes
      expect(part).toContain("3");            // quests
      expect(part).toContain("https://x.test/u?token=t1");
    }
    expect(html).toContain("Tuesday");        // bestDay 2
    expect(html).toContain("9:00");
    expect(html).toContain("defeated");
  });

  it("omits zero rows entirely (no '0 coins' lines)", () => {
    const { html, text } = renderRecapEmail(
      stats({ coinsEarned: 0, levelUps: 0, badges: [], questlinesCompleted: [], boss: null, rhythms: null }),
      "N.", "https://x.test/u",
    );
    expect(html).not.toContain("Coins");
    expect(html).not.toContain("Level-up");
    expect(html).not.toContain("World Boss");
    expect(text).not.toContain("Coins");
  });

  it("escapes HTML in user-controlled strings", () => {
    const { html } = renderRecapEmail(
      stats({ badges: ["<script>alert(1)</script>"] }), "N.", "https://x.test/u",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
