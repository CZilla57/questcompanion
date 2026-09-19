import { describe, it, expect, beforeAll } from "vitest";
import { KIND_ROUTE, type CandidateKind } from "./notification-envelope";

// notification-scheduler.ts pulls in @workspace/db at module scope (real
// route/table imports for the envelope producers), and that module throws at
// import time if DATABASE_URL is unset — a guard against ever constructing a
// real Pool without one. We never touch the db in this test (buildNotifyPayload
// is a pure payload builder), so a dummy connection string is enough to satisfy
// the guard: pg's Pool/drizzle() are both lazy and open no connection until a
// query actually runs. Loading is deferred to a dynamic import inside
// beforeAll so this assignment runs before notification-scheduler.ts is
// evaluated (a static top-of-file import would be hoisted ahead of it).
let buildNotifyPayload: typeof import("./notification-scheduler").buildNotifyPayload;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  }
  ({ buildNotifyPayload } = await import("./notification-scheduler"));
});

// Task 4 Step 5: every push dispatched through notify() funnels through
// buildNotifyPayload, which must stamp data.target from the candidate's kind
// before the payload ever reaches pushToUser — this is the single choke point,
// so covering it here covers every kind of dispatched push.
describe("buildNotifyPayload", () => {
  it("stamps data.target from KIND_ROUTE for every CandidateKind", () => {
    for (const kind of Object.keys(KIND_ROUTE) as CandidateKind[]) {
      const payload = buildNotifyPayload(kind, "T", "B", "tag");
      expect(payload.data).toEqual({ target: KIND_ROUTE[kind] });
    }
  });

  it("preserves existing data fields (e.g. a context-nudge url) alongside the stamped target", () => {
    const payload = buildNotifyPayload("context_nudge", "T", "B", "tag", { url: "/tasks" });
    expect(payload.data).toEqual({ url: "/tasks", target: KIND_ROUTE.context_nudge });
  });

  it("stamps a target even when no extra data is supplied", () => {
    const payload = buildNotifyPayload("hyperfocus", "T", "B", "tag", undefined);
    expect(payload.data).toEqual({ target: KIND_ROUTE.hyperfocus });
  });
});
