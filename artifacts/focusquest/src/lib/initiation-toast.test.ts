import { describe, it, expect } from "vitest";
import { initiationToast } from "./initiation-toast";

describe("initiationToast", () => {
  it("returns null when nothing was awarded", () => {
    expect(initiationToast(undefined)).toBeNull();
    expect(initiationToast(null)).toBeNull();
    expect(initiationToast({ total: 0, awards: [] })).toBeNull();
  });

  it("celebrates a single award", () => {
    const t = initiationToast({ total: 2, awards: [{ kind: "session_start", points: 2 }] });
    expect(t).toEqual({
      title: "You started — that's the hard part. +2 XP",
      description: "Started +2",
    });
  });

  it("joins a burst with middots", () => {
    const t = initiationToast({
      total: 12,
      awards: [
        { kind: "session_start", points: 2 },
        { kind: "questline_kickoff", points: 5 },
        { kind: "first_move", points: 5 },
      ],
    });
    expect(t?.description).toBe("Started +2 · Questline kickoff +5 · First move today +5");
  });

  it("labels first_step and falls back to the raw kind for unknowns", () => {
    const t = initiationToast({
      total: 4,
      awards: [
        { kind: "first_step", points: 3 },
        { kind: "mystery_kind" as never, points: 1 },
      ],
    });
    expect(t?.description).toBe("First step +3 · mystery_kind +1");
  });
});
