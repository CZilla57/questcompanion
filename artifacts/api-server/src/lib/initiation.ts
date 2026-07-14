/**
 * Celebrate Starting — pure initiation-XP rules (Act I).
 *
 * The ADHD wall is starting, not finishing: these awards celebrate the moment
 * work begins. Two events exist (a focus session starting, a breakdown step
 * checked to done); four award kinds ride them. This module is pure — routes
 * gather state and apply granted awards via lib/initiation-grant.ts.
 */

export const SESSION_START_XP = 2;
export const FIRST_STEP_XP = 3;
export const QUESTLINE_KICKOFF_XP = 5;
export const FIRST_MOVE_XP = 5;
export const SESSION_START_COOLDOWN_MS = 10 * 60 * 1000;

export type InitiationKind = "session_start" | "first_step" | "questline_kickoff" | "first_move";

export interface InitiationEvent {
  type: "session_start" | "step_check";
  /** The task the event is tied to (step_check always; session_start optionally). */
  task?: { id: number; title: string; questlineId: number | null } | null;
  /** step_check only: some OTHER step of this task was already done. */
  otherStepsAlreadyDone?: boolean;
}

export interface InitiationState {
  /** awarded_at of the newest session_start award, or null. */
  lastSessionStartAwardAt: Date | null;
  /** A first_step award already exists for this task. */
  taskFirstStepAwarded: boolean;
  /** A questline_kickoff award already exists for this task's questline. */
  questlineKickoffAwarded: boolean;
  /** awarded_at of the newest first_move award, or null. */
  lastFirstMoveAt: Date | null;
  /** UTC instant of local midnight today in the user's timezone. */
  dayStartUtc: Date;
  /** Title of the task's questline (kickoff copy), when it has one. */
  questlineTitle?: string | null;
}

export interface GrantedAward {
  kind: InitiationKind;
  points: number;
  refId: number | null;
  description: string;
}

export interface InitiationXp {
  total: number;
  awards: { kind: InitiationKind; points: number }[];
}

export function evaluateInitiationAwards(
  event: InitiationEvent,
  state: InitiationState,
  now: Date,
): GrantedAward[] {
  const granted: GrantedAward[] = [];

  if (event.type === "session_start") {
    const last = state.lastSessionStartAwardAt;
    const offCooldown = last === null || now.getTime() - last.getTime() >= SESSION_START_COOLDOWN_MS;
    if (offCooldown) {
      granted.push({
        kind: "session_start",
        points: SESSION_START_XP,
        refId: null,
        description: "Started a focus session",
      });
    }
  }

  if (event.type === "step_check" && event.task && !event.otherStepsAlreadyDone && !state.taskFirstStepAwarded) {
    granted.push({
      kind: "first_step",
      points: FIRST_STEP_XP,
      refId: event.task.id,
      description: `Checked the first step of "${event.task.title}"`,
    });
  }

  if (event.task?.questlineId != null && !state.questlineKickoffAwarded) {
    const name = state.questlineTitle ? `"${state.questlineTitle}"` : "a questline";
    granted.push({
      kind: "questline_kickoff",
      points: QUESTLINE_KICKOFF_XP,
      refId: event.task.questlineId,
      description: `Kicked off ${name}`,
    });
  }

  if (state.lastFirstMoveAt === null || state.lastFirstMoveAt.getTime() < state.dayStartUtc.getTime()) {
    granted.push({
      kind: "first_move",
      points: FIRST_MOVE_XP,
      refId: null,
      description: "First move of the day",
    });
  }

  return granted;
}

export function toInitiationXp(granted: GrantedAward[]): InitiationXp {
  return {
    total: granted.reduce((sum, g) => sum + g.points, 0),
    awards: granted.map((g) => ({ kind: g.kind, points: g.points })),
  };
}
