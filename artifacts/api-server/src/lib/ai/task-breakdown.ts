export const MIN_STEPS = 3;
export const MAX_STEPS = 6;
export const MAX_STEP_LENGTH = 120;

export class BreakdownParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BreakdownParseError";
  }
}

export interface BreakdownInput {
  title: string;
  description?: string | null;
  category?: string | null;
  estimatedMinutes?: number | null;
}

// The breakdown seam: given a prompt, return the model's parsed JSON. Provider-
// agnostic — the prompt itself specifies the { steps: string[] } shape (see
// buildBreakdownPrompt), so any JSON-mode chat model satisfies it.
export type GenerateJson = (prompt: string) => Promise<unknown>;

export function buildBreakdownPrompt(input: BreakdownInput): string {
  const context: string[] = [`Task: ${input.title}`];
  if (input.description) context.push(`Details: ${input.description}`);
  if (input.category && input.category !== "default") context.push(`Category: ${input.category}`);
  if (input.estimatedMinutes) context.push(`Estimated time: ${input.estimatedMinutes} minutes`);

  return `You help people with ADHD start tasks they've been avoiding. Break the task below into ${MIN_STEPS}-${MAX_STEPS} concrete first steps that beat the initiation wall.

Rules:
- The FIRST step must be trivially easy — a 2-minute "just start" action that requires no decisions (e.g. "Grab a trash bag and a box").
- Every step is a single concrete PHYSICAL action, written as a present-tense imperative.
- Never use vague verbs like "organize", "sort out", "deal with", or "handle" — name the specific visible action instead.
- Keep each step to a short phrase, not a sentence.
- Do not restate the task itself as a step.
- Return between ${MIN_STEPS} and ${MAX_STEPS} steps.

${context.join("\n")}

Respond with JSON only, in this exact shape: {"steps": ["first step", "second step", "..."]}`;
}

export function parseBreakdown(raw: unknown): string[] {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { steps?: unknown }).steps)
  ) {
    throw new BreakdownParseError("Model output did not match { steps: string[] }");
  }

  const steps = ((raw as { steps: unknown[] }).steps)
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.length > MAX_STEP_LENGTH ? s.slice(0, MAX_STEP_LENGTH) : s))
    .slice(0, MAX_STEPS);

  if (steps.length < MIN_STEPS) {
    throw new BreakdownParseError(`Expected at least ${MIN_STEPS} steps, got ${steps.length}`);
  }
  return steps;
}

export async function breakdownTask(
  input: BreakdownInput,
  generate: GenerateJson,
): Promise<string[]> {
  const prompt = buildBreakdownPrompt(input);
  const raw = await generate(prompt);
  return parseBreakdown(raw);
}
