import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, rescueEventsTable, tasksTable } from "@workspace/db";
import { parseRescueEvent } from "../lib/rescue-events";
import { struggleDeltaOnRescue } from "../lib/difficulty";

const router: IRouter = Router();

router.post("/rescue/events", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const parsed = parseRescueEvent(req.body);
  if (!parsed.ok) {
    res.status(422).json({ error: parsed.error });
    return;
  }
  const { taskId, blocker, intervention } = parsed.value;

  if (taskId !== null) {
    const [task] = await db.select({ id: tasksTable.id, struggleScore: tasksTable.struggleScore })
      .from(tasksTable)
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    // "Too big" is direct evidence the quest needs resizing; weight it heavier.
    const delta = struggleDeltaOnRescue(blocker);
    await db.update(tasksTable).set({ struggleScore: task.struggleScore + delta })
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)));
  }

  const [inserted] = await db
    .insert(rescueEventsTable)
    .values({ userId, taskId, blocker, intervention })
    .returning({ id: rescueEventsTable.id });

  res.status(201).json({ id: inserted!.id });
});

export default router;
