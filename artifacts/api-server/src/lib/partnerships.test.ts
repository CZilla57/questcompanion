import { describe, it, expect } from "vitest";
import { resolvePartnerRequest } from "./partnerships";

describe("resolvePartnerRequest", () => {
  it("creates a fresh request when no rows exist", () => {
    expect(resolvePartnerRequest([])).toEqual({ action: "create" });
  });

  it("reactivates when only a declined row exists", () => {
    expect(resolvePartnerRequest([{ id: 7, status: "declined" }])).toEqual({
      action: "reactivate",
      staleIds: [7],
    });
  });

  it("reactivates and lists every stale declined row", () => {
    expect(
      resolvePartnerRequest([
        { id: 7, status: "declined" },
        { id: 9, status: "declined" },
      ]),
    ).toEqual({ action: "reactivate", staleIds: [7, 9] });
  });

  it("rejects when a pending request already exists", () => {
    const decision = resolvePartnerRequest([{ id: 3, status: "pending" }]);
    expect(decision.action).toBe("reject");
  });

  it("rejects when the users are already allies", () => {
    const decision = resolvePartnerRequest([{ id: 4, status: "accepted" }]);
    expect(decision.action).toBe("reject");
    if (decision.action === "reject") {
      expect(decision.reason).toMatch(/already allies/i);
    }
  });

  it("prefers the 'already allies' reason when both accepted and declined rows exist", () => {
    const decision = resolvePartnerRequest([
      { id: 4, status: "accepted" },
      { id: 5, status: "declined" },
    ]);
    expect(decision.action).toBe("reject");
    if (decision.action === "reject") {
      expect(decision.reason).toMatch(/already allies/i);
    }
  });
});
