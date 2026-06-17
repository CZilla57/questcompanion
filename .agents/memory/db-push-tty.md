---
name: drizzle-kit push TTY requirement
description: drizzle-kit push fails in non-interactive shells; use executeSql instead
---

## The problem

`pnpm --filter @workspace/db run push` (and `drizzle-kit push --force`) prompt
interactively when adding unique constraints to tables that already have rows.
In a bash tool (non-TTY), it exits with an error about `process.stdin.isTTY`.

**Why:** drizzle-kit asks "do you want to truncate?" when adding a unique index to a
non-empty table, even if all existing values are NULL (which satisfy the constraint).

**How to apply:** Use `executeSql` in code_execution to run the DDL directly:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS replit_id varchar UNIQUE;
CREATE TABLE IF NOT EXISTS sessions (sid varchar PRIMARY KEY, sess jsonb NOT NULL, expire timestamp NOT NULL);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire);
```
The db package has a `push-force` script but it still triggers the same prompt.
