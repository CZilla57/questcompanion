export const RESCUE_BLOCKERS = ["too_big", "cant_start", "overwhelmed", "wrong_quest"] as const;
export type RescueBlocker = (typeof RESCUE_BLOCKERS)[number];

export const RESCUE_INTERVENTIONS = ["breakdown", "micro_start", "emergency_mode", "reroll"] as const;
export type RescueIntervention = (typeof RESCUE_INTERVENTIONS)[number];

export interface RescueEventInput {
  taskId: number | null;
  blocker: RescueBlocker;
  intervention: RescueIntervention;
}

export function parseRescueEvent(
  body: unknown,
): { ok: true; value: RescueEventInput } | { ok: false; error: string } {
  const b = body as { taskId?: unknown; blocker?: unknown; intervention?: unknown } | null | undefined;

  let taskId: number | null = null;
  if (b?.taskId !== undefined && b.taskId !== null) {
    if (typeof b.taskId !== "number" || !Number.isInteger(b.taskId)) {
      return { ok: false, error: "taskId must be an integer" };
    }
    taskId = b.taskId;
  }
  if (!(RESCUE_BLOCKERS as readonly unknown[]).includes(b?.blocker)) {
    return { ok: false, error: "Unknown blocker" };
  }
  if (!(RESCUE_INTERVENTIONS as readonly unknown[]).includes(b?.intervention)) {
    return { ok: false, error: "Unknown intervention" };
  }
  return { ok: true, value: { taskId, blocker: b!.blocker as RescueBlocker, intervention: b!.intervention as RescueIntervention } };
}
