import { Router, type IRouter } from "express";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db, personalEncountersTable } from "@workspace/db";
import { buildBestiary, type FoeFell } from "../lib/encounter-progress";

const router: IRouter = Router();

// Act V (Depth & Collection): the Bestiary — a discovery log you complete by
// felling each foe in the roster. Fully DERIVED from personal_encounters (name +
// felledAt), so there is no new table. Anti-shame: an unmet foe is a silhouette
// ("not yet encountered"), never "unbeaten".
router.get("/bestiary", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  // Every foe this hero has felled (name + when), and the one they're facing now.
  const felledRows = await db
    .select({ name: personalEncountersTable.name, felledAt: personalEncountersTable.felledAt })
    .from(personalEncountersTable)
    .where(and(eq(personalEncountersTable.userId, userId), isNotNull(personalEncountersTable.felledAt)));

  const [activeRow] = await db
    .select({ name: personalEncountersTable.name })
    .from(personalEncountersTable)
    .where(and(eq(personalEncountersTable.userId, userId), isNull(personalEncountersTable.felledAt)));

  const fells: FoeFell[] = felledRows
    .filter((r): r is { name: string; felledAt: Date } => r.felledAt !== null)
    .map((r) => ({ name: r.name, felledAt: r.felledAt }));

  res.json(buildBestiary(fells, activeRow?.name ?? null));
});

export default router;
