import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, kingdomPointsTable } from "@workspace/db";
import { capitalLifetime, capitalProgress, type KingdomId } from "../lib/kingdoms";

const router: IRouter = Router();

// Act V (Depth & Collection): the Capital — the hero's seat, a home that
// visibly grows. Derived from the sum of lifetime kingdom points (the same
// signal the kingdom map already shows), with fine-grained progress toward the
// next tier. No new schema; monotonic, so the capital only ever grows.
router.get("/capital", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const rows = await db.select().from(kingdomPointsTable).where(eq(kingdomPointsTable.userId, userId));
  const lifetimeByKingdom: Partial<Record<KingdomId, number>> = {};
  for (const r of rows) lifetimeByKingdom[r.kingdomId as KingdomId] = r.lifetimePoints;

  res.json(capitalProgress(capitalLifetime(lifetimeByKingdom)));
});

export default router;
