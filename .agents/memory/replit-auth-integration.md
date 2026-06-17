---
name: Replit Auth integration for FocusQuest
description: How Replit OIDC auth is wired into the existing integer-keyed game user schema
---

## The bridging pattern

The Replit Auth skill's usersTable (varchar id = OIDC sub) conflicts with FocusQuest's
game usersTable (serial integer id). The solution:

1. Added `replit_id` varchar UNIQUE nullable column to the existing `users` table.
2. `SessionData` extended with `gameUserId: number` alongside the standard `user: AuthUser`.
3. `upsertGameUser(claims)` in auth route: lookup by `replitId = claims.sub`, create game
   user if missing (auto-generates username from OIDC first/last name + 4-digit suffix).
4. `authMiddleware` sets both `req.user` (AuthUser/OIDC) and `req.gameUserId` (integer).
5. All protected routes use `req.isAuthenticated()` + `req.gameUserId` — no DEFAULT_USER_ID.

**Why:** The game schema predates auth and uses integer PKs everywhere (tasks.userId,
partnerships.requesterId, etc.), so we can't switch to string IDs without a full migration.

**How to apply:** Any new protected route must call req.isAuthenticated() first, then use
req.gameUserId for all DB queries scoped to the caller.
