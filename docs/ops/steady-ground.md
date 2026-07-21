# Steady Ground — ops runbook (Act VII q7)

## Backup cron (GitHub Actions)
- Workflow: `.github/workflows/backup-cron.yml` — POSTs `/api/cron/tick` every 5 min.
- One-time setup after merge: `gh secret set CRON_SECRET` (same value as Render's
  env var / cron-job.org), then run the workflow once from the Actions tab
  (workflow_dispatch) and confirm `http=200`.
- Failure drill (optional): pause the cron-job.org job for 15 minutes — pushes
  keep flowing on the 5-min backup cadence; re-enable afterwards.

## Dead-man's switch (healthchecks.io, free tier)
- Create one check at https://healthchecks.io — period 10 min, grace 5 min.
- Set `HEARTBEAT_URL` on the Render service to the check's ping URL. Unset = no-op.
- The tick pings AFTER all passes complete, so an alert means "no full tick
  finished in ~15 minutes" across BOTH schedulers.

## Account deletion — Auth0 side
`DELETE /api/me` erases every FocusQuest row (the `USER_DATA_TABLES` registry —
guard-tested against the schema) and all sessions, in one transaction. The
Auth0 identity (login credential) is separate; free-tier cleanup is manual:
Auth0 dashboard → User Management → Users → ⋯ → Delete. Until then the person
can log in again, which creates a FRESH empty FocusQuest account — the old
rows are gone and nothing links back.

## Export
`GET /api/me/export` (session-authed) returns one attachment JSON:
`{ exportedAt, user, data: { <table>: rows[] } }` across every registered
user-keyed table. Sessions are transport state — never exported.
