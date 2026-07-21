import { describe, it, expect } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";
import { USER_DATA_TABLES } from "./account-data";

// Walk every drizzle table exported by @workspace/db and collect the
// (tableName, columnName) pairs whose FK targets users.id. sessions is
// excluded automatically: it has no FK (the userId lives inside the jsonb)
// and account deletion handles it explicitly.
function userFkPairs(): Set<string> {
  const pairs = new Set<string>();
  for (const exported of Object.values(schema)) {
    let cfg;
    try {
      cfg = getTableConfig(exported as PgTable);
    } catch {
      continue; // not a table export
    }
    if (cfg.name === "users") continue;
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      const targetCfg = getTableConfig(ref.foreignTable as PgTable);
      if (targetCfg.name !== "users") continue;
      for (const col of ref.columns) pairs.add(`${cfg.name}.${col.name}`);
    }
  }
  return pairs;
}

function registryPairs(): Set<string> {
  const pairs = new Set<string>();
  for (const t of USER_DATA_TABLES) {
    const cfg = getTableConfig(t.table as PgTable);
    for (const c of t.userColumns) pairs.add(`${cfg.name}.${c.name}`);
  }
  return pairs;
}

describe("USER_DATA_TABLES registry (standing guard)", () => {
  it("covers every schema column that references users.id — new user tables must be registered for delete/export", () => {
    const registry = registryPairs();
    const missing = [...userFkPairs()].filter((p) => !registry.has(p));
    expect(missing).toEqual([]);
  });

  it("contains no stale entries the schema no longer backs", () => {
    const fks = userFkPairs();
    const stale = [...registryPairs()].filter((p) => !fks.has(p));
    expect(stale).toEqual([]);
  });

  it("names are unique export keys", () => {
    const names = USER_DATA_TABLES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("is topologically delete-safe: every registered table precedes tables it references", () => {
    // The DELETE /api/me transaction walks the list top-to-bottom, so a table
    // holding a non-cascading FK into another registered table must come
    // FIRST (child before parent) or Postgres raises foreign_key_violation.
    const position = new Map<string, number>();
    USER_DATA_TABLES.forEach((t, i) => position.set(getTableConfig(t.table as PgTable).name, i));

    const violations: string[] = [];
    for (const t of USER_DATA_TABLES) {
      const cfg = getTableConfig(t.table as PgTable);
      for (const fk of cfg.foreignKeys) {
        const target = getTableConfig(fk.reference().foreignTable as PgTable).name;
        if (target === "users" || !position.has(target)) continue;
        if (position.get(cfg.name)! > position.get(target)!) {
          violations.push(`${cfg.name} (#${position.get(cfg.name)}) references ${target} (#${position.get(target)}) but is deleted after it`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
