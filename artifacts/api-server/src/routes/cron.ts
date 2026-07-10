import { Router, type IRouter } from "express";
import { tick } from "../lib/notification-scheduler";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/cron/tick", async (req, res) => {
  const secret = process.env["CRON_SECRET"];
  if (!secret) {
    res.status(503).json({ error: "CRON_SECRET not configured" });
    return;
  }

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const ran = await tick();
    logger.info({ ran }, "Cron tick completed");
    res.json({ ok: true, ran });
  } catch (err) {
    logger.error({ err }, "Cron tick failed");
    res.status(500).json({ error: "tick failed" });
  }
});

export default router;
