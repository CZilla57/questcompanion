import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/coins", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const [user] = await db
    .select({ balance: usersTable.coinBalance })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  res.json({ balance: user?.balance ?? 0 });
});

export default router;
