/**
 * Pure decision logic for how to handle an incoming accountability-partner
 * request, given the partnership rows that already exist between the two users
 * (in either direction).
 *
 * Kept separate from the route handler so the branching can be unit-tested
 * without a database.
 */

export interface ExistingPartnership {
  id: number;
  status: string;
}

export type PartnerRequestDecision =
  /** No relevant rows — insert a fresh pending request. */
  | { action: "create" }
  /**
   * Only stale `declined` rows remain — delete them first, then insert a fresh
   * pending request. `staleIds` lists the rows to remove.
   */
  | { action: "reactivate"; staleIds: number[] }
  /** An active (pending/accepted) relationship exists — reject with a reason. */
  | { action: "reject"; reason: string };

/**
 * Decide what to do with a new partner request.
 *
 * - An existing `accepted` row → the two are already allies (reject).
 * - An existing `pending` row → a request is already in flight (reject).
 * - Only `declined` rows → allow a fresh request, clearing the stale rows.
 * - No rows → create a fresh request.
 */
export function resolvePartnerRequest(
  existing: ExistingPartnership[],
): PartnerRequestDecision {
  if (existing.length === 0) {
    return { action: "create" };
  }

  if (existing.some((p) => p.status === "accepted")) {
    return { action: "reject", reason: "You are already allies with this user." };
  }

  if (existing.some((p) => p.status === "pending")) {
    return {
      action: "reject",
      reason: "A partner request is already pending with this user.",
    };
  }

  // Everything that remains is `declined` (or some other terminal state) — let
  // the user try again, but clear the stale rows so we don't hit the
  // duplicate-row guard.
  return { action: "reactivate", staleIds: existing.map((p) => p.id) };
}
