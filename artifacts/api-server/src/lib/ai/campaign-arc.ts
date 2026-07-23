// Act VI Quest Campaigns: draft a story arc over a real goal. Pure except for
// the injected generator, mirroring ai/questline-quests.ts. Output is
// SNAPSHOTTED to the campaign row at creation and never regenerated on read.
import type { GenerateJson } from "./task-breakdown";
import { MIN_CHAPTERS, MAX_CHAPTERS } from "../campaign-arc";

export const MAX_TITLE_LENGTH = 120;
export const MAX_BEAT_LENGTH = 240;
export const MAX_PREMISE_LENGTH = 320;

export class CampaignArcParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignArcParseError";
  }
}

export interface DraftChapter { title: string; beat: string }
export interface DraftArc {
  arcPremise: string;
  endingBeat: string;
  chapters: DraftChapter[];
}

export function buildCampaignArcPrompt(goal: string): string {
  return `You help people with ADHD carry a long goal by telling it as a short story arc. Break the goal below into ${MIN_CHAPTERS}-${MAX_CHAPTERS} chapters, and write one line of story for each.

Rules:
- Each chapter TITLE is a concrete stage of the real work, written as a short present-tense imperative phrase.
- Order chapters from the easiest starting stage to later progress.
- The FIRST chapter must be a tiny, no-decision starting stage that still makes real progress.
- Each chapter BEAT is one sentence of warm narration for finishing that chapter. Never scold, never mention falling behind, never mention time passing or days missed.
- The arcPremise is one or two sentences on why this journey is worth walking. The endingBeat is one sentence for finishing the whole thing.
- No comfort rituals, warm-ups, or filler (never "get motivated", "make a plan to plan").
- Never use vague verbs like "organize", "work on", "deal with", or "handle" — name the specific stage.
- Do not restate the goal itself as a chapter.

Goal: ${goal}

Respond with JSON only, in this exact shape: {"arcPremise": "...", "endingBeat": "...", "chapters": [{"title": "...", "beat": "..."}]}`;
}

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return t.length > max ? t.slice(0, max) : t;
}

export function parseCampaignArc(raw: unknown): DraftArc {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { chapters?: unknown }).chapters)) {
    throw new CampaignArcParseError("Model output did not match { chapters: [...] }");
  }
  const src = raw as { arcPremise?: unknown; endingBeat?: unknown; chapters: unknown[] };

  const chapters: DraftChapter[] = src.chapters
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({ title: str(c.title, MAX_TITLE_LENGTH), beat: str(c.beat, MAX_BEAT_LENGTH) }))
    .filter((c) => c.title.length > 0)
    .slice(0, MAX_CHAPTERS);

  if (chapters.length < MIN_CHAPTERS) {
    throw new CampaignArcParseError(
      `Expected at least ${MIN_CHAPTERS} chapters, got ${chapters.length}`,
    );
  }

  return {
    arcPremise: str(src.arcPremise, MAX_PREMISE_LENGTH),
    endingBeat: str(src.endingBeat, MAX_BEAT_LENGTH),
    chapters,
  };
}

export async function suggestCampaignArc(goal: string, generate: GenerateJson): Promise<DraftArc> {
  const raw = await generate(buildCampaignArcPrompt(goal));
  return parseCampaignArc(raw);
}
