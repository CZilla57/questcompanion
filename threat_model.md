# Threat Model

## Project Overview

FocusQuest is a gamified task and habit tracker with a React frontend and an Express API backed by PostgreSQL. The production security boundary is the `/api` server in `artifacts/api-server/src/`; the browser client and service worker are untrusted, and all state-changing behavior must be enforced server-side. The mockup sandbox is development-only and out of scope unless shared code becomes reachable from production. The current deployment visibility is `private`, so platform access controls limit network reachability, but any viewer who can reach the deployment and any authenticated app user must still be treated as untrusted with respect to application data and state.

## Assets

- **User task data and activity history** — task titles, descriptions, due dates, completion history, recurring schedules, and activity log entries reveal behavioral patterns and personal routines.
- **User progression state** — XP totals, streaks, badges, leaderboard position, and partnership state are business-critical state that must not be writable by other users.
- **Partner relationship data** — partnership requests and partner activity feeds expose social-graph and progress information that should only be visible to authorized participants.
- **Push subscription records** — push endpoints and keys let the server send notifications on behalf of a user and can be abused for notification hijacking or outbound request abuse.
- **Application secrets** — `DATABASE_URL`, `SESSION_SECRET`, and VAPID private key material would allow data or messaging compromise if exposed.

## Trust Boundaries

- **Browser / service worker to API** — every request from the frontend or a crafted external client is untrusted and must be authenticated, authorized, and validated by the API.
- **Same-site sibling origin to API** — because Replit deployments live under a shared site, a malicious page hosted on another `*.replit.app` origin can be same-site with this app even when it is cross-origin. CORS and cookie policy therefore must not assume that cross-origin means cookie-less or uncredentialed.
- **API to PostgreSQL** — the API has broad authority over user records, tasks, partnerships, activity, badges, and push subscriptions; broken access control here becomes direct data compromise.
- **API to external push endpoints** — the notification subsystem makes outbound requests using VAPID credentials to subscription endpoints stored in the database.
- **Per-instance scheduler to shared database** — recurring-task spawning and push reminders run inside the API process. In an autoscaled deployment, multiple instances can execute the same scheduler logic concurrently unless the database enforces uniqueness or the app uses a distributed lock.
- **Public vs authenticated surface** — health and possibly leaderboard-style endpoints may be public, but user profile, tasks, recurring tasks, badges, notifications, and partnership state are authenticated user surfaces and must be bound to the caller’s identity.
- **Deployment viewer vs app user** — because the deployment is private, some routes may only be reachable by approved deployment viewers, but that platform gate does not replace in-app authorization or privacy controls for data exposed to those viewers.
- **Production vs dev-only artifacts** — `artifacts/mockup-sandbox/` is non-production and should not drive findings unless shared code creates a production path.

## Scan Anchors

- Production API entry points: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/`.
- Highest-risk code areas: user-scoped route handlers, XP/gear/battle reward flows, notification subscription/delivery flow, and recurring-task scheduler.
- Public surface: `/api/healthz` and any intentionally public leaderboard/search functionality.
- Authenticated surface: `/api/users/me*`, `/api/tasks*`, `/api/recurring-tasks*`, `/api/accountability/*`, `/api/notifications/*`, `/api/users/me/badges`.
- Usually ignore: `artifacts/mockup-sandbox/`, generated API client code, and build outputs under `dist/`.

## Threat Categories

### Spoofing

The API must derive caller identity from a verified session or bearer token on every protected request. A request must never inherit a fixed or client-chosen identity, and push subscription state must only be attachable to the authenticated account that owns it. Because sibling `*.replit.app` origins can be same-site without being trusted, browser-authenticated APIs must not rely on cookie `SameSite` behavior alone to separate trusted and untrusted callers.

### Tampering

Task state, recurring schedules, XP totals, streaks, badges, gear inventory, battle outcomes, and partnership state are all high-value mutable records. The server must ensure that only the owning user can create, update, complete, or delete their own records, and that user-visible progression is computed server-side from authorized actions rather than from caller-supplied identity or trusted client state. Completion and uncompletion flows must also be idempotent and fully reversible, because partial or non-atomic reward logic lets users mint XP, bonuses, badges, or inventory without corresponding work. Any scheduler-generated rows must be protected against cross-instance duplication in autoscaled production.

### Information Disclosure

User task content, activity history, and partner relationship data can expose personal routines and progress information. API responses must be scoped to the authenticated caller or an explicitly authorized partner relationship, and logs or error responses must not leak secrets, tokens, or internal details. Partnership revocation is an authorization boundary: once a user declines or removes a partner relationship, that former partner must not be able to restore feed access without a fresh consent flow from the other side.

### Denial of Service

Publicly reachable endpoints that create tasks, recurring schedules, partnership requests, or push subscriptions can be abused to create database churn or force repeated scheduler work. Any endpoint that triggers persistent storage or downstream notification work should assume hostile traffic and bound request volume and payload size.

### Elevation of Privilege

Because the API can read and mutate every user’s persisted state, missing authentication or broken ownership checks effectively give an attacker another user’s privileges. Outbound notification delivery also creates a privileged server-side capability that must not be steerable to attacker-chosen endpoints without authorization and validation.
