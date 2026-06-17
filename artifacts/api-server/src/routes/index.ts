import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import tasksRouter from "./tasks";
import badgesRouter from "./badges";
import accountabilityRouter from "./accountability";
import leaderboardRouter from "./leaderboard";
import notificationsRouter from "./notifications";
import recurringTasksRouter from "./recurring-tasks";
import avatarRouter from "./avatar";
import gearRouter from "./gear";
import battleRouter from "./battle";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(tasksRouter);
router.use(recurringTasksRouter);
router.use(badgesRouter);
router.use(accountabilityRouter);
router.use(leaderboardRouter);
router.use(notificationsRouter);
router.use(avatarRouter);
router.use(gearRouter);
router.use(battleRouter);

export default router;
