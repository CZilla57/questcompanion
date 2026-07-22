import { describe, it, expect } from "vitest";
import {
  buildCampaignArcPrompt,
  parseCampaignArc,
  suggestCampaignArc,
  CampaignArcParseError,
  MAX_TITLE_LENGTH,
  MAX_BEAT_LENGTH,
} from "./campaign-arc";

const ok = {
  arcPremise: "A premise.",
  endingBeat: "An ending.",
  chapters: [
    { title: "Clear one shelf", beat: "It begins." },
    { title: "Sort the boxes", beat: "It builds." },
    { title: "Haul it out", beat: "It ends." },
  ],
};

describe("buildCampaignArcPrompt", () => {
  it("includes the goal", () => {
    expect(buildCampaignArcPrompt("make the garage usable")).toContain("make the garage usable");
  });
  it("states the chapter range and the JSON shape", () => {
    const p = buildCampaignArcPrompt("x");
    expect(p).toContain("3");
    expect(p).toContain("5");
    expect(p).toContain("arcPremise");
    expect(p).toContain("endingBeat");
  });
});

describe("parseCampaignArc", () => {
  it("accepts a well-formed arc", () => {
    expect(parseCampaignArc(ok).chapters).toHaveLength(3);
  });
  it("rejects a non-object", () => {
    expect(() => parseCampaignArc("nope")).toThrow(CampaignArcParseError);
  });
  it("rejects a missing chapters array", () => {
    expect(() => parseCampaignArc({ arcPremise: "a", endingBeat: "b" })).toThrow(CampaignArcParseError);
  });
  it("rejects fewer than three usable chapters", () => {
    expect(() => parseCampaignArc({ ...ok, chapters: ok.chapters.slice(0, 2) })).toThrow(CampaignArcParseError);
  });
  it("drops chapters with an empty title before counting", () => {
    const bad = { ...ok, chapters: [...ok.chapters.slice(0, 2), { title: "   ", beat: "x" }] };
    expect(() => parseCampaignArc(bad)).toThrow(CampaignArcParseError);
  });
  it("clamps to five chapters", () => {
    const many = { ...ok, chapters: Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, beat: `b${i}` })) };
    expect(parseCampaignArc(many).chapters).toHaveLength(5);
  });
  it("truncates over-long titles and beats", () => {
    const long = {
      ...ok,
      chapters: ok.chapters.map((c) => ({ title: "t".repeat(400), beat: "b".repeat(900) })),
    };
    const parsed = parseCampaignArc(long);
    expect(parsed.chapters[0]!.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(parsed.chapters[0]!.beat).toHaveLength(MAX_BEAT_LENGTH);
  });
  it("tolerates a missing beat by substituting an empty string", () => {
    const noBeat = { ...ok, chapters: ok.chapters.map((c) => ({ title: c.title })) };
    expect(parseCampaignArc(noBeat).chapters[0]!.beat).toBe("");
  });
  it("tolerates missing premise/ending by substituting empty strings", () => {
    const bare = { chapters: ok.chapters };
    const parsed = parseCampaignArc(bare);
    expect(parsed.arcPremise).toBe("");
    expect(parsed.endingBeat).toBe("");
  });
});

describe("suggestCampaignArc", () => {
  it("passes the prompt to the injected generator and parses the result", async () => {
    let seen = "";
    const generate = async (prompt: string) => { seen = prompt; return ok; };
    const arc = await suggestCampaignArc("tidy the loft", generate);
    expect(seen).toContain("tidy the loft");
    expect(arc.chapters).toHaveLength(3);
  });
  it("propagates a parse failure", async () => {
    const generate = async () => ({ nope: true });
    await expect(suggestCampaignArc("x", generate)).rejects.toBeInstanceOf(CampaignArcParseError);
  });
});
