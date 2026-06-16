import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import tasksRouter from "./tasks";
import badgesRouter from "./badges";
import accountabilityRouter from "./accountability";
import leaderboardRouter from "./leaderboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(tasksRouter);
router.use(badgesRouter);
router.use(accountabilityRouter);
router.use(leaderboardRouter);

export default router;
