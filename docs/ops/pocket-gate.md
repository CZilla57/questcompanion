# Pocket Gate — ops notes

iPhone home-screen quick actions: Apple Shortcuts → `fqs_` tokens → three
whitelisted routes. Spec: `docs/superpowers/specs/2026-07-21-pocket-gate-design.md`.

## Surface

| Call | Auth | Notes |
|---|---|---|
| `POST /api/shortcut-tokens` `{label?}` | session only | 201; plaintext `token` in this response only; cap 5 active |
| `GET /api/shortcut-tokens` | session only | metadata, never hashes |
| `DELETE /api/shortcut-tokens/:id` | session only | idempotent revoke |
| `POST /api/shortcuts/capture` `{text}` | token or session | deterministic parse, dateless → local today, never anchored |
| `GET /api/shortcuts/today` | token or session | `{count, message, quests: {title→id}}`, cap 25 |
| `POST /api/tasks/:id/complete` | token or session | the app's real completion route, whitelisted for tokens |

A token authenticates ONLY those last three calls (default-deny in
authMiddleware). Storage is sha256-only: `select token_hash from api_tokens`
can never leak a usable secret.

## Smoke test (PowerShell, after deploy)

Mint a token in the app UI (account dialog → Home Screen Shortcuts), then:

    $h = @{ Authorization = "Bearer fqs_…" }
    Invoke-RestMethod -Method Post -Uri "https://<app-domain>/api/shortcuts/capture" -Headers $h -ContentType "application/json" -Body '{"text":"pocket gate smoke test"}'
    Invoke-RestMethod -Uri "https://<app-domain>/api/shortcuts/today" -Headers $h
    # complete the smoke-test quest with the id from either response:
    Invoke-RestMethod -Method Post -Uri "https://<app-domain>/api/tasks/<id>/complete" -Headers $h -ContentType "application/json" -Body '{}'
    # default-deny proof — MUST return 401:
    Invoke-RestMethod -Uri "https://<app-domain>/api/shortcut-tokens" -Headers $h

## Recipes

The user-facing set-up guide lives in the app (account dialog → Set-up guide);
the same steps are in the spec §10. Rate limits: capture 2s, today 2s, mint 10s
per user (in-memory, reset on deploy). Revocation is immediate.
