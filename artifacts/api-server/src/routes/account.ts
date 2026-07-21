import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { DeleteAccountRequestConfirm } from "@workspace/api-zod";
import { USER_DATA_TABLES, userWhere } from "../lib/account-data";
import { clearSession, getSessionId } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Single source of truth is the OpenAPI enum — codegen pins this same literal
// into the web client, so the two sides cannot drift.
export const DELETE_CONFIRM_PHRASE = DeleteAccountRequestConfirm.delete_my_account;

// One honest JSON of everything user-keyed. Sessions are transport state,
// not user data — deleted on account deletion, never exported.
router.get("/me/export", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  // Sequential on purpose: a 23-way Promise.all would grab the whole pg pool
  // (default max 10) for a download nobody is racing. Export isn't latency-critical.
  const entries: [string, unknown[]][] = [];
  for (const t of USER_DATA_TABLES) {
    const rows = await db.select().from(t.table as never).where(userWhere(t, userId));
    entries.push([t.name, rows]);
  }

  const stamp = new Date().toISOString();
  res.setHeader("Content-Disposition", `attachment; filename="focusquest-export-${stamp.slice(0, 10)}.json"`);
  res.json({ exportedAt: stamp, user, data: Object.fromEntries(entries) });
});

// Cascading, transactional, unrecoverable-by-design. The confirm phrase is
// re-checked server-side so nothing but a deliberate client call can land here.
router.delete("/me", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  if (req.body?.confirm !== DELETE_CONFIRM_PHRASE) {
    res.status(400).json({ error: `Body must include confirm: "${DELETE_CONFIRM_PHRASE}"` });
    return;
  }

  await db.transaction(async (tx) => {
    for (const t of USER_DATA_TABLES) {
      await tx.delete(t.table as never).where(userWhere(t, userId));
    }
    // Sessions carry gameUserId inside the jsonb — every device logs out.
    await tx.delete(sessionsTable)
      .where(sql`(${sessionsTable.sess} ->> 'gameUserId')::int = ${userId}`);
    await tx.delete(usersTable).where(eq(usersTable.id, userId));
  });

  await clearSession(res, getSessionId(req));
  logger.info({ userId }, "Account deleted");
  res.json({ success: true });
});

export default router;
