import { describe, it, expect } from "vitest";
import type { InitiationXp } from "@workspace/api-client-react";
import { initiationToast } from "./initiation-toast";

describe("initiationToast", () => {
  it("returns null when nothing was awarded", () => {
    expect(initiationToast(null)).toBeNull();
    expect(initiationToast(undefined)).toBeNull();
    expect(initiationToast({ total: 0, awards: [] } as InitiationXp)).toBeNull();
  });

  it("celebrates the total and lists the awards", () => {
    const xp = { total: 15, awards: [{ kind: "session_start", points: 15 }] } as InitiationXp;
    const t = initiationToast(xp);
    expect(t).not.toBeNull();
    expect(t!.title).toContain("+15 XP");
    expect(t!.description).toContain("Started +15");
  });
});
