import { describe, it, expect } from "vitest";
import {
  DAILY_PUSH_BUDGET, PUSH_SPACING_MIN, KIND_META, inQuietHours, selectPush,
  validatePrefsBody, type PushCandidate, type EnvelopeState,
} from "./notification-envelope";

const allOn = {
  protection: true, reminders: true, reflection: true, hero: true,
  quietHoursStart: 22, quietHoursEnd: 8,
};

type StateOver = Partial<Omit<EnvelopeState, "prefs">> & { prefs?: Partial<EnvelopeState["prefs"]> };
function state(over: StateOver = {}): EnvelopeState {
  const { prefs: prefsOver, ...rest } = over;
  return {
    localHour: 12,
    localToday: "2026-07-19",
    pushesSentDate: null,
    pushesSentCount: 0,
    lastPushAt: null,
    now: new Date("2026-07-19T17:00:00Z"),
    ...rest,
    prefs: { ...allOn, ...(prefsOver ?? {}) },
  };
}

function cand(kind: PushCandidate["kind"], title = kind): PushCandidate {
  return { kind, title, body: "b", tag: kind };
}

describe("KIND_META", () => {
  it("maps every kind to its category and class per spec", () => {
    expect(KIND_META.hyperfocus).toEqual({ category: "protection", klass: "critical" });
    expect(KIND_META.hunger_warning).toEqual({ category: "hero", klass: "reminder" });
    expect(KIND_META.context_nudge).toEqual({ category: "reminders", klass: "reminder" });
    expect(KIND_META.reflection_prompt).toEqual({ category: "reflection", klass: "reflection" });
    expect(KIND_META.companion_milestone).toEqual({ category: "hero", klass: "milestone" });
    expect(KIND_META.hero_flavor).toEqual({ category: "hero", klass: "ambient" });
  });
});

describe("inQuietHours", () => {
  it("handles a midnight-wrapping window", () => {
    expect(inQuietHours(23, 22, 8)).toBe(true);
    expect(inQuietHours(3, 22, 8)).toBe(true);
    expect(inQuietHours(8, 22, 8)).toBe(false);  // end exclusive
    expect(inQuietHours(12, 22, 8)).toBe(false);
    expect(inQuietHours(22, 22, 8)).toBe(true);  // start inclusive
  });
  it("handles a same-day window and the empty window", () => {
    expect(inQuietHours(13, 13, 15)).toBe(true);
    expect(inQuietHours(15, 13, 15)).toBe(false);
    expect(inQuietHours(12, 12, 12)).toBe(false); // start === end ⇒ no quiet hours
  });
});

describe("selectPush — global gates", () => {
  it("deep-night floor [2,7) silences every class, even critical", () => {
    for (const hour of [2, 4, 6]) {
      expect(selectPush([cand("hyperfocus")], state({ localHour: hour }))).toBeNull();
    }
    expect(selectPush([cand("hyperfocus")], state({ localHour: 7 }))).not.toBeNull();
  });
  it("90-min spacing blocks all sends; 91 minutes clears it", () => {
    const now = new Date("2026-07-19T17:00:00Z");
    const recent = new Date(now.getTime() - (PUSH_SPACING_MIN - 1) * 60_000);
    const old = new Date(now.getTime() - (PUSH_SPACING_MIN + 1) * 60_000);
    expect(selectPush([cand("hyperfocus")], state({ now, lastPushAt: recent }))).toBeNull();
    expect(selectPush([cand("hyperfocus")], state({ now, lastPushAt: old }))).not.toBeNull();
  });
  it("daily budget caps at 3 for every class, and resets on a new local day", () => {
    const spent = state({ pushesSentDate: "2026-07-19", pushesSentCount: DAILY_PUSH_BUDGET });
    expect(selectPush([cand("hyperfocus")], spent)).toBeNull();
    const newDay = state({ pushesSentDate: "2026-07-18", pushesSentCount: DAILY_PUSH_BUDGET });
    expect(selectPush([cand("hyperfocus")], newDay)).not.toBeNull();
  });
});

describe("selectPush — per-candidate filters", () => {
  it("drops candidates whose category pref is off", () => {
    const s = state({ prefs: { hero: false } });
    expect(selectPush([cand("hero_flavor")], s)).toBeNull();
    expect(selectPush([cand("hero_flavor"), cand("context_nudge")], s)?.kind).toBe("context_nudge");
  });
  it("enforces class windows: ambient [8,22), reminder [7,22)", () => {
    expect(selectPush([cand("hero_flavor")], state({ localHour: 7, prefs: { quietHoursStart: 0, quietHoursEnd: 0 } }))).toBeNull();
    expect(selectPush([cand("context_nudge")], state({ localHour: 7, prefs: { quietHoursStart: 0, quietHoursEnd: 0 } }))).not.toBeNull();
    expect(selectPush([cand("hero_flavor")], state({ localHour: 22 }))).toBeNull();
    expect(selectPush([cand("hyperfocus")], state({ localHour: 23 }))).not.toBeNull();
  });
  it("user quiet hours silence non-critical but never critical", () => {
    const s = state({ localHour: 23 }); // default quiet 22→8
    expect(selectPush([cand("context_nudge")], s)).toBeNull();
    expect(selectPush([cand("hyperfocus")], s)?.kind).toBe("hyperfocus");
  });
  it("default quiet hours push the reminder window start from 7 to 8", () => {
    expect(selectPush([cand("context_nudge")], state({ localHour: 7 }))).toBeNull();
    expect(selectPush([cand("context_nudge")], state({ localHour: 8 }))).not.toBeNull();
  });
});

describe("selectPush — priority", () => {
  it("critical beats reminder beats reflection beats milestone beats ambient", () => {
    const all = [cand("hero_flavor"), cand("companion_milestone"), cand("reflection_prompt"), cand("context_nudge"), cand("hyperfocus")];
    expect(selectPush(all, state({ localHour: 20 }))?.kind).toBe("hyperfocus");
    expect(selectPush(all.slice(0, 4), state({ localHour: 20 }))?.kind).toBe("context_nudge");
    expect(selectPush(all.slice(0, 3), state({ localHour: 20 }))?.kind).toBe("reflection_prompt");
    expect(selectPush(all.slice(0, 2), state({ localHour: 20 }))?.kind).toBe("companion_milestone");
    expect(selectPush(all.slice(0, 1), state({ localHour: 20 }))?.kind).toBe("hero_flavor");
  });
  it("is stable within a class (first offered wins)", () => {
    const a = { ...cand("hunger_warning"), title: "first" };
    const b = { ...cand("context_nudge"), title: "second" };
    expect(selectPush([a, b], state({ localHour: 12 }))?.title).toBe("first");
  });
  it("returns null for no candidates", () => {
    expect(selectPush([], state())).toBeNull();
  });
});

describe("validatePrefsBody", () => {
  const good = { protection: true, reminders: false, reflection: true, hero: true, quietHoursStart: 22, quietHoursEnd: 8 };
  it("accepts a full valid body", () => {
    expect(validatePrefsBody(good)).toEqual({ ok: true, value: good });
  });
  it("rejects missing keys, wrong types, and out-of-range hours", () => {
    expect(validatePrefsBody({ ...good, protection: "yes" }).ok).toBe(false);
    const { hero, ...missing } = good;
    expect(validatePrefsBody(missing).ok).toBe(false);
    expect(validatePrefsBody({ ...good, quietHoursStart: 24 }).ok).toBe(false);
    expect(validatePrefsBody({ ...good, quietHoursEnd: -1 }).ok).toBe(false);
    expect(validatePrefsBody({ ...good, quietHoursEnd: 7.5 }).ok).toBe(false);
    expect(validatePrefsBody(null).ok).toBe(false);
  });
});
