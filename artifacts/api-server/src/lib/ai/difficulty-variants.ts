export const MAX_VARIANT_STEPS = 6;
export const MAX_VARIANT_STEP_LENGTH = 120;

export class VariantsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VariantsParseError";
  }
}

export interface VariantInput {
  title: string;
  description?: string | null;
  category?: string | null;
  estimatedMinutes?: number | null;
  steps?: string[];
}

export interface VariantDraft {
  title: string;
  estimatedMinutes: number;
  steps: string[];
}

export interface VariantsResult {
  easy: VariantDraft;
  hard: VariantDraft;
}

// Same provider-agnostic seam as task-breakdown: the prompt states the JSON shape.
export type GenerateJson = (prompt: string) => Promise<unknown>;

export function buildVariantsPrompt(input: VariantInput): string {
  const context: string[] = [`Quest: ${input.title}`];
  if (input.description) context.push(`Details: ${input.description}`);
  if (input.category && input.category !== "default") context.push(`Category: ${input.category}`);
  if (input.estimatedMinutes) context.push(`Current estimate: ${input.estimatedMinutes} minutes`);
  if (input.steps && input.steps.length) context.push(`Current steps: ${input.steps.join("; ")}`);

  return `You help people with ADHD by re-scoping a quest into a genuinely SMALLER version and a fuller BIGGER version, so they can pick the size that fits their energy right now.

Rules:
- "easy" is a legitimately SMALLER slice of the SAME quest that still counts as real progress — lower activation cost, roughly a third of the time, fewer steps. It is NOT "do it worse", NOT a warm-up, and NOT the same quest with more sub-steps. Example: "Clean the kitchen" -> "Clear and wipe the counters".
- "hard" is the fuller, more thorough version of the same intent.
- Keep every title a short present-tense imperative in the user's own voice.
- easy.estimatedMinutes MUST be a positive integer strictly LESS than hard.estimatedMinutes.
- Each rung may include 0 to ${MAX_VARIANT_STEPS} concrete steps (short phrases), or an empty list.
- Encouraging tone, never patronizing. Never imply the user failed.

${context.join("\n")}

Respond with JSON only, in this exact shape: {"easy":{"title":"...","estimatedMinutes":5,"steps":["..."]},"hard":{"title":"...","estimatedMinutes":40,"steps":["..."]}}`;
}

function parseDraft(raw: unknown, rung: string): VariantDraft {
  if (!raw || typeof raw !== "object") {
    throw new VariantsParseError(`Missing "${rung}" rung`);
  }
  const r = raw as { title?: unknown; estimatedMinutes?: unknown; steps?: unknown };

  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) throw new VariantsParseError(`"${rung}" has an empty title`);

  const est = typeof r.estimatedMinutes === "number" ? Math.round(r.estimatedMinutes) : NaN;
  if (!Number.isFinite(est) || est <= 0) {
    throw new VariantsParseError(`"${rung}" needs a positive estimatedMinutes`);
  }

  const steps = Array.isArray(r.steps)
    ? r.steps
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => (s.length > MAX_VARIANT_STEP_LENGTH ? s.slice(0, MAX_VARIANT_STEP_LENGTH) : s))
        .slice(0, MAX_VARIANT_STEPS)
    : [];

  return { title, estimatedMinutes: est, steps };
}

export function parseVariants(raw: unknown): VariantsResult {
  if (!raw || typeof raw !== "object") {
    throw new VariantsParseError("Model output was not an object");
  }
  const obj = raw as { easy?: unknown; hard?: unknown };
  const easy = parseDraft(obj.easy, "easy");
  const hard = parseDraft(obj.hard, "hard");
  if (!(easy.estimatedMinutes < hard.estimatedMinutes)) {
    throw new VariantsParseError("easy estimate must be strictly smaller than hard");
  }
  return { easy, hard };
}

export async function generateVariants(
  input: VariantInput,
  generate: GenerateJson,
): Promise<VariantsResult> {
  const prompt = buildVariantsPrompt(input);
  const raw = await generate(prompt);
  return parseVariants(raw);
}
