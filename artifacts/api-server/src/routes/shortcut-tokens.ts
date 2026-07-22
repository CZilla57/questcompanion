import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, apiTokensTable } from "@workspace/db";
import { mintTokenSecret } from "../lib/shortcut-token";
import { mintCooldown } from "../lib/shortcut-cooldowns";

const router: IRouter = Router();

export const MAX_ACTIVE_TOKENS = 5;
const MAX_LABEL_LEN = 60;

// Pocket Gate token management. Session-auth only BY CONSTRUCTION: these
// paths are off the D4 whitelist, so a shortcut token never authenticates
// here — a leaked token can capture and complete quests, nothing else.

router.get("/shortcut-tokens", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db.select({
    id: apiTokensTable.id,
    label: apiTokensTable.label,
    createdAt: apiTokensTable.createdAt,
    lastUsedAt: apiTokensTable.lastUsedAt,
  }).from(apiTokensTable)
    .where(and(eq(apiTokensTable.userId, req.gameUserId), isNull(apiTokensTable.revokedAt)))
    .orderBy(apiTokensTable.createdAt);
  res.json(rows);
});

router.post("/shortcut-tokens", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  if (!mintCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Slow down a moment before creating another token." });
    return;
  }

  const labelRaw = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  const label = labelRaw.slice(0, MAX_LABEL_LEN) || "iPhone";

  const active = await db.select({ id: apiTokensTable.id }).from(apiTokensTable)
    .where(and(eq(apiTokensTable.userId, userId), isNull(apiTokensTable.revokedAt)));
  if (active.length >= MAX_ACTIVE_TOKENS) {
    res.status(400).json({ error: `You already have ${MAX_ACTIVE_TOKENS} active tokens — revoke one first.` });
    return;
  }

  const { token, tokenHash } = mintTokenSecret();
  const [row] = await db.insert(apiTokensTable).values({ userId, tokenHash, label }).returning();
  if (!row) { res.status(500).json({ error: "Token insert failed" }); return; }
  // The ONLY place plaintext ever leaves the server.
  res.status(201).json({ id: row.id, label: row.label, createdAt: row.createdAt, token });
});

router.delete("/shortcut-tokens/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Idempotent: revoking an unknown or already-revoked id is a quiet success.
  await db.update(apiTokensTable).set({ revokedAt: new Date() })
    .where(and(
      eq(apiTokensTable.id, id),
      eq(apiTokensTable.userId, req.gameUserId),
      isNull(apiTokensTable.revokedAt),
    ));
  res.json({ success: true });
});

export default router;
