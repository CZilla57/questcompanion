import { describe, it, expect } from "vitest";
import { classifyMigrationFailure } from "./migration-failure";

describe("classifyMigrationFailure", () => {
  describe("fatal — the migration SQL is wrong", () => {
    it.each([
      ["42601", "syntax error"],
      ["42703", "undefined column"],
      ["42P07", "duplicate table"],
      ["23503", "foreign key violation"],
      ["23505", "unique violation"],
      ["22P02", "invalid text representation"],
    ])("treats %s (%s) as fatal", (code) => {
      expect(classifyMigrationFailure({ code })).toBe("fatal");
    });
  });

  describe("transient — the database is unavailable, not the SQL wrong", () => {
    it.each([
      ["XX000", "internal error — how an exhausted compute quota surfaces"],
      ["53300", "too many connections"],
      ["57P03", "cannot connect now, server starting up"],
      ["08006", "connection failure"],
      ["08001", "client unable to establish connection"],
    ])("treats %s (%s) as transient", (code) => {
      expect(classifyMigrationFailure({ code })).toBe("transient");
    });

    it.each(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "CERT_HAS_EXPIRED"])(
      "treats node error code %s as transient",
      (code) => {
        expect(classifyMigrationFailure({ code })).toBe("transient");
      },
    );

    it("defaults to transient when there is no code at all", () => {
      expect(classifyMigrationFailure(new Error("boom"))).toBe("transient");
      expect(classifyMigrationFailure(undefined)).toBe("transient");
      expect(classifyMigrationFailure(null)).toBe("transient");
      expect(classifyMigrationFailure("a string")).toBe("transient");
    });
  });

  describe("unwrapping", () => {
    it("finds a SQLSTATE nested under cause, as drizzle throws it", () => {
      const err = Object.assign(new Error("Failed query"), {
        cause: Object.assign(new Error("syntax error"), { code: "42601" }),
      });
      expect(classifyMigrationFailure(err)).toBe("fatal");
    });

    it("reproduces the 2026-07-28 outage error as transient", () => {
      // The real shape: drizzle's wrapper, then the driver error carrying XX000.
      const err = Object.assign(new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"'), {
        cause: Object.assign(
          new Error("Your account or project has exceeded the compute time quota."),
          { code: "XX000", severity: "ERROR" },
        ),
      });
      expect(classifyMigrationFailure(err)).toBe("transient");
    });

    it("prefers a nested SQLSTATE over an outer non-SQLSTATE code", () => {
      const err = Object.assign(new Error("wrapped"), {
        code: "ERR_DRIZZLE",
        cause: Object.assign(new Error("inner"), { code: "42703" }),
      });
      expect(classifyMigrationFailure(err)).toBe("fatal");
    });

    it("does not recurse forever on a cyclic cause chain", () => {
      const err: { code: string; cause?: unknown } = { code: "ERR_A" };
      err.cause = err;
      expect(classifyMigrationFailure(err)).toBe("transient");
    });
  });
});
