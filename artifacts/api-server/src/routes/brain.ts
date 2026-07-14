import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, brainCheckinsTable } from "@workspace/db";
import { deriveBrainState, isBrainMode, isCheckinSource, type BrainState } from "../lib/brain-mode";

const router: IRouter = Router();

function serializeState(s: BrainState) {
  return {
    mode: s.mode,
    since: s.since ? s.since.toISOString() : null,
    expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
    checkedInToday: s.checkedInToday,
  };
}

async function latestCheckin(userId: number) {
  const [row] = await db
    .select()
    .from(brainCheckinsTable)
    .where(eq(brainCheckinsTable.userId, userId))
    .orderBy(desc(brainCheckinsTable.createdAt), desc(brainCheckinsTable.id))
    .limit(1);
  return row;
}

router.get("/brain/state", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const tz = String(req.query.tz ?? "");

  const latest = await latestCheckin(userId);
  res.json(serializeState(deriveBrainState(latest, new Date(), tz)));
});

router.post("/brain/checkins", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const mode: unknown = req.body?.mode;
  const source: unknown = req.body?.source ?? "tap";
  const tz = String(req.body?.tz ?? "");

  if (!isBrainMode(mode)) {
    res.status(422).json({ error: "Unknown mode" });
    return;
  }
  if (!isCheckinSource(source)) {
    res.status(422).json({ error: "Unknown source" });
    return;
  }

  const [inserted] = await db
    .insert(brainCheckinsTable)
    .values({ userId, mode, source })
    .returning();

  res.status(201).json(serializeState(deriveBrainState(inserted!, new Date(), tz)));
});

export default router;
