# @workspace/db

Drizzle schema + migrations for the Neon Postgres database.

## Changing the schema

1. Edit `src/schema/*.ts`.
2. Generate a migration:
   ```sh
   pnpm --filter @workspace/db generate
   ```
   This writes `drizzle/NNNN_<name>.sql` plus a `drizzle/meta/` snapshot. **Read the
   generated SQL before committing it** — it is the thing that will run against
   production.
3. Commit the SQL and the `meta/` files together. They are a matched set; the
   migrator reads `meta/_journal.json` to decide what to apply.

Migrations apply automatically on deploy (see below). To apply them against the
database in `DATABASE_URL` yourself:

```sh
export DATABASE_URL="$(grep -E '^DATABASE_URL=' ../../.env | cut -d= -f2-)"
pnpm --filter @workspace/db migrate
```

`pnpm --filter @workspace/db check` validates that the migration history is
internally consistent (no collisions or gaps).

## Why not `drizzle-kit push`?

`push` was removed on 2026-07-19. It diffs your schema against a *live
introspection* of the database on every run, and drizzle-kit 0.31.10 reads the
columns of a multi-column `UNIQUE` constraint in reverse-alphabetical order
rather than ordinal order. Any constraint whose real order isn't
reverse-alphabetical therefore looks changed, and push proposes to drop and
recreate it — prompting to **truncate the table**.

In this schema that hit `weekly_battles_user_week_unique` and
`weekly_recaps_user_week_unique` (both `user_id, week_key`). It presented as
"schema drift" but the database and the TS schema were identical the whole time.
There is no fixed stable release — 0.31.10 is the latest, with only `1.0.0-rc.*`
beyond it.

`generate` doesn't introspect the database at all. It diffs the schema against
the committed migration history, so the bug cannot fire. The generated SQL is
reviewable before it runs, which is what you want against a database with real
users in it.

## Deploys

The Dockerfile copies `drizzle/` to `dist/drizzle` and runs `dist/migrate.mjs`
before starting the server. A failed migration exits non-zero and aborts the
boot rather than serving traffic against a half-migrated database.

This runs migrations on container start, which is safe on Render's single-instance
free tier. If the service is ever scaled to multiple instances, move it to a
release/pre-deploy step so two containers can't migrate concurrently.

## Baselining an existing database

The `0000_baseline` migration describes the schema as it already existed on
2026-07-19. The live database was marked as having applied it by inserting its
hash and journal timestamp into `drizzle.__drizzle_migrations` — the tables were
already there, so running it would have failed.

Any *new* environment should run the baseline normally; it creates everything
from scratch. Only pre-existing databases need the manual ledger insert.
