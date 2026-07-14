import { describe, it, expect } from "vitest";
import {
  evaluateInitiationAwards, toInitiationXp,
  SESSION_START_XP, FIRST_STEP_XP, QUESTLINE_KICKOFF_XP, FIRST_MOVE_XP,
  SESSION_START_COOLDOWN_MS,
  type InitiationEvent, type InitiationState,
} from "./initiation";

const NOW = new Date("2026-07-13T18:00:00.000Z");
const DAY_START = new Date("2026-07-13T04:00:00.000Z"); // local midnight (America/New_York)

/** Baseline state: everything already awarded / on cooldown, so nothing fires. */
function quietState(over: Partial<InitiationState> = {}): InitiationState {
  return {
    lastSessionStartAwardAt: new Date(NOW.getTime() - 60_000), // 1 min ago → on cooldown
    taskFirstStepAwarded: true,
    questlineKickoffAwarded: true,
    lastFirstMoveAt: new Date(NOW.getTime() - 3_600_000),      // this local day
    dayStartUtc: DAY_START,
    questlineTitle: null,
    ...over,
  };
}

const sessionEvent = (task?: InitiationEvent["task"]): InitiationEvent =>
  ({ type: "session_start", task: task ?? null });
const stepEvent = (task: NonNullable<InitiationEvent["task"]>, otherStepsAlreadyDone: boolean): InitiationEvent =>
  ({ type: "step_check", task, otherStepsAlreadyDone });

const plainTask = { id: 42, title: "Fold laundry", questlineId: null };
const questlineTask = { id: 43, title: "Draft outline", questlineId: 7 };

describe("session_start cooldown", () => {
  it("awards when no start was ever awarded", () => {
    const g = evaluateInitiationAwards(sessionEvent(), quietState({ lastSessionStartAwardAt: null }), NOW);
    expect(g).toEqual([{ kind: "session_start", points: SESSION_START_XP, refId: null, description: "Started a focus session" }]);
  });
  it("does not award 9m59s after the last awarded start", () => {
    const last = new Date(NOW.getTime() - (SESSION_START_COOLDOWN_MS - 1_000));
    expect(evaluateInitiationAwards(sessionEvent(), quietState({ lastSessionStartAwardAt: last }), NOW)).toEqual([]);
  });
  it("awards at exactly 10 minutes (>= boundary pays)", () => {
    const last = new Date(NOW.getTime() - SESSION_START_COOLDOWN_MS);
    const g = evaluateInitiationAwards(sessionEvent(), quietState({ lastSessionStartAwardAt: last }), NOW);
    expect(g.map((a) => a.kind)).toEqual(["session_start"]);
  });
});

describe("first_step", () => {
  it("awards the first step of a quest once", () => {
    const g = evaluateInitiationAwards(
      stepEvent(plainTask, false),
      quietState({ taskFirstStepAwarded: false }),
      NOW,
    );
    expect(g).toEqual([{ kind: "first_step", points: FIRST_STEP_XP, refId: 42, description: 'Checked the first step of "Fold laundry"' }]);
  });
  it("stays sticky: no re-award after uncheck/recheck (ledger row exists)", () => {
    expect(evaluateInitiationAwards(stepEvent(plainTask, false), quietState(), NOW)).toEqual([]);
  });
  it("never awards when another step was already done (pre-feature progress)", () => {
    const g = evaluateInitiationAwards(stepEvent(plainTask, true), quietState({ taskFirstStepAwarded: false }), NOW);
    expect(g).toEqual([]);
  });
  it("never awards on a session_start event", () => {
    const g = evaluateInitiationAwards(sessionEvent(plainTask), quietState({ taskFirstStepAwarded: false }), NOW);
    expect(g).toEqual([]);
  });
});

describe("questline_kickoff", () => {
  it("fires on a session start on a questline task", () => {
    const g = evaluateInitiationAwards(
      sessionEvent(questlineTask),
      quietState({ questlineKickoffAwarded: false, questlineTitle: "Spring cleaning" }),
      NOW,
    );
    expect(g).toEqual([{ kind: "questline_kickoff", points: QUESTLINE_KICKOFF_XP, refId: 7, description: 'Kicked off "Spring cleaning"' }]);
  });
  it("fires on a step check on a questline task, with a title fallback", () => {
    const g = evaluateInitiationAwards(
      stepEvent(questlineTask, true),
      quietState({ questlineKickoffAwarded: false, questlineTitle: null }),
      NOW,
    );
    expect(g).toEqual([{ kind: "questline_kickoff", points: QUESTLINE_KICKOFF_XP, refId: 7, description: "Kicked off a questline" }]);
  });
  it("only fires once per questline", () => {
    expect(evaluateInitiationAwards(sessionEvent(questlineTask), quietState(), NOW)).toEqual([]);
  });
  it("does not fire for a task without a questline", () => {
    const g = evaluateInitiationAwards(sessionEvent(plainTask), quietState({ questlineKickoffAwarded: false }), NOW);
    expect(g).toEqual([]);
  });
});

describe("first_move", () => {
  it("awards when never awarded", () => {
    const g = evaluateInitiationAwards(sessionEvent(), quietState({ lastFirstMoveAt: null }), NOW);
    expect(g).toEqual([{ kind: "first_move", points: FIRST_MOVE_XP, refId: null, description: "First move of the day" }]);
  });
  it("awards when the last one was before today's local day start", () => {
    const yesterday = new Date(DAY_START.getTime() - 3_600_000);
    const g = evaluateInitiationAwards(sessionEvent(), quietState({ lastFirstMoveAt: yesterday }), NOW);
    expect(g.map((a) => a.kind)).toEqual(["first_move"]);
  });
  it("does not award twice in the same local day", () => {
    expect(evaluateInitiationAwards(sessionEvent(), quietState(), NOW)).toEqual([]);
  });
  it("fires even when session_start is on cooldown", () => {
    const g = evaluateInitiationAwards(sessionEvent(), quietState({ lastFirstMoveAt: null }), NOW);
    expect(g.map((a) => a.kind)).toEqual(["first_move"]);
  });
  it("fires on a step_check event too", () => {
    const g = evaluateInitiationAwards(stepEvent(plainTask, true), quietState({ lastFirstMoveAt: null }), NOW);
    expect(g).toEqual([{ kind: "first_move", points: FIRST_MOVE_XP, refId: null, description: "First move of the day" }]);
  });
});

describe("stacking + summary", () => {
  it("morning burst: start on a questline task, fresh day → +12", () => {
    const g = evaluateInitiationAwards(
      sessionEvent(questlineTask),
      quietState({
        lastSessionStartAwardAt: null,
        questlineKickoffAwarded: false,
        questlineTitle: "Spring cleaning",
        lastFirstMoveAt: null,
      }),
      NOW,
    );
    expect(g.map((a) => a.kind)).toEqual(["session_start", "questline_kickoff", "first_move"]);
    const xp = toInitiationXp(g);
    expect(xp.total).toBe(12);
    expect(xp.awards).toEqual([
      { kind: "session_start", points: 2 },
      { kind: "questline_kickoff", points: 5 },
      { kind: "first_move", points: 5 },
    ]);
  });
  it("toInitiationXp of nothing is a zero summary", () => {
    expect(toInitiationXp([])).toEqual({ total: 0, awards: [] });
  });
});
