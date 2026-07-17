import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, usersTable, weeklyRecapsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/recaps", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const [user] = await db
    .select({ email: usersTable.email, recapEmailsEnabled: usersTable.recapEmailsEnabled })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  // Skipped (zero-signal) weeks and rows that died before content-fill are
  // structurally absent from the archive — nothing to feel bad about.
  const rows = await db.select().from(weeklyRecapsTable)
    .where(and(
      eq(weeklyRecapsTable.userId, userId),
      eq(weeklyRecapsTable.skipped, false),
      isNotNull(weeklyRecapsTable.narrative),
    ))
    .orderBy(desc(weeklyRecapsTable.createdAt));

  res.json({
    emailEnabled: user?.recapEmailsEnabled ?? true,
    emailKnown: Boolean(user?.email),
    recaps: rows.map((r) => ({
      weekKey: r.weekKey,
      stats: r.stats,
      narrative: r.narrative,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    })),
  });
});

router.patch("/users/me/recap-emails", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const enabled = (req.body as { enabled?: unknown }).enabled;
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  await db.update(usersTable).set({ recapEmailsEnabled: enabled }).where(eq(usersTable.id, req.gameUserId!));
  res.json({ emailEnabled: enabled });
});

// Identical page for valid and unknown tokens — no token oracle, no guilt.
const UNSUB_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FocusQuest</title></head>
<body style="margin:0;background:#0f1420;color:#e2e8f0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="max-width:420px;padding:32px;text-align:center;">
    <h1 style="color:#00ffff;font-size:20px;margin:0 0 12px;">You're unsubscribed 🌙</h1>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">No more weekly recap emails. Your recaps still live on your Insights page whenever you want them — and you can turn emails back on there any time.</p>
    <a href="https://getfocusquest.com/insights" style="color:#00ffff;font-size:14px;">Open FocusQuest →</a>
  </div>
</body></html>`;

router.get("/recaps/unsubscribe", async (req, res): Promise<void> => {
  const token = String(req.query.token ?? "");
  if (token) {
    await db.update(usersTable)
      .set({ recapEmailsEnabled: false })
      .where(eq(usersTable.recapUnsubscribeToken, token));
  }
  res.status(200).type("html").send(UNSUB_PAGE);
});

export default router;
