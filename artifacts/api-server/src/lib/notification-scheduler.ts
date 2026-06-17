import { eq, and, gt } from "drizzle-orm";
import { db, tasksTable, usersTable, activityTable, pushSubscriptionsTable } from "@workspace/db";
import { sendPushNotification } from "./push-notifications";
import { logger } from "./logger";
import { spawnRecurringTasksForToday } from "../routes/recurring-tasks";

const DEFAULT_USER_ID = 1;

async function getSubscriptions(userId: number) {
  return db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId));
}

async function removeSubscription(endpoint: string) {
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
}

async function notify(userId: number, title: string, body: string, tag: string) {
  const subs = await getSubscriptions(userId);
  for (const sub of subs) {
    const ok = await sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { title, body, tag },
    );
    if (!ok) {
      await removeSubscription(sub.endpoint);
    }
  }
}

async function checkDueTasks() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  if (currentHour < 7 || currentHour >= 22) return;

  if (currentHour === 8 && currentMinute === 0) {
    const pendingTasks = await db.select().from(tasksTable).where(
      and(eq(tasksTable.dueDate, today), eq(tasksTable.completed, false), eq(tasksTable.userId, DEFAULT_USER_ID)),
    );
    if (pendingTasks.length > 0) {
      await notify(
        DEFAULT_USER_ID,
        "Morning Quest Check",
        `You have ${pendingTasks.length} quest${pendingTasks.length === 1 ? "" : "s"} to complete today. Let's go!`,
        "morning-reminder",
      );
    }
  }

  if (currentHour === 12 && currentMinute === 0) {
    const pendingTasks = await db.select().from(tasksTable).where(
      and(eq(tasksTable.dueDate, today), eq(tasksTable.completed, false), eq(tasksTable.userId, DEFAULT_USER_ID)),
    );
    if (pendingTasks.length > 0) {
      await notify(
        DEFAULT_USER_ID,
        "Midday Check-in",
        `Still ${pendingTasks.length} quest${pendingTasks.length === 1 ? "" : "s"} waiting. Afternoon push — you've got this.`,
        "midday-reminder",
      );
    }
  }

  if (currentHour === 19 && currentMinute === 0) {
    const allTasks = await db.select().from(tasksTable).where(
      and(eq(tasksTable.dueDate, today), eq(tasksTable.userId, DEFAULT_USER_ID)),
    );
    const pending = allTasks.filter((t) => !t.completed);
    if (pending.length > 0 && allTasks.length > 0) {
      await notify(
        DEFAULT_USER_ID,
        "Evening Quest Warning",
        `${pending.length} quest${pending.length === 1 ? "" : "s"} left today. Complete them all for the daily bonus!`,
        "evening-reminder",
      );
    }
  }
}

async function sendDailySummary() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  if (currentHour !== 21 || currentMinute !== 0) return;

  const today = now.toISOString().split("T")[0];

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, DEFAULT_USER_ID));
  if (!user) return;

  // Gather today's task stats
  const allTodayTasks = await db.select().from(tasksTable).where(
    and(eq(tasksTable.userId, DEFAULT_USER_ID), eq(tasksTable.dueDate, today)),
  );

  const completedToday = allTodayTasks.filter((t) => t.completed);
  const totalTasks = allTodayTasks.length;
  const doneCount = completedToday.length;
  const remainingCount = totalTasks - doneCount;

  // XP earned today from the activity log (points > 0)
  const todayStart = new Date(today + "T00:00:00.000Z");
  const activityRows = await db.select().from(activityTable).where(
    and(
      eq(activityTable.userId, DEFAULT_USER_ID),
      gt(activityTable.points, 0),
    ),
  );
  const xpToday = activityRows
    .filter((a) => a.createdAt >= todayStart)
    .reduce((sum, a) => sum + a.points, 0);

  const streakDays = user.streakDays;
  const streakSafe = user.lastActiveDate === today;

  // --- Scenario A: all tasks done (or no tasks due and streak is safe) ---
  if (totalTasks > 0 && doneCount === totalTasks) {
    const streakLine = streakDays > 0
      ? ` ${streakDays}-day streak intact! 🔥`
      : "";
    await notify(
      DEFAULT_USER_ID,
      "Quest Complete! 🎯",
      `All ${totalTasks} quest${totalTasks === 1 ? "" : "s"} done · ${xpToday} XP earned today.${streakLine}`,
      "daily-summary",
    );
    return;
  }

  // --- Scenario B: partial progress, some tasks remain ---
  if (totalTasks > 0 && doneCount > 0 && remainingCount > 0) {
    const xpLine = xpToday > 0 ? ` · ${xpToday} XP earned` : "";
    const streakLine = streakSafe ? ` Streak safe (${streakDays}d).` : " Streak at risk!";
    await notify(
      DEFAULT_USER_ID,
      "Evening Debrief",
      `${doneCount}/${totalTasks} quests done${xpLine}. ${remainingCount} remaining —${streakLine}`,
      "daily-summary",
    );
    return;
  }

  // --- Scenario C: nothing done, streak at risk ---
  if (doneCount === 0 && streakDays > 0) {
    const taskLine = totalTasks > 0
      ? ` You have ${totalTasks} quest${totalTasks === 1 ? "" : "s"} open.`
      : "";
    await notify(
      DEFAULT_USER_ID,
      "Streak Alert! ⚠️",
      `Your ${streakDays}-day streak ends at midnight.${taskLine} Complete one quest to keep it alive!`,
      "daily-summary",
    );
    return;
  }

  // --- Scenario D: nothing done, no streak — gentle nudge ---
  if (doneCount === 0 && totalTasks > 0) {
    await notify(
      DEFAULT_USER_ID,
      "Quest Log Waiting",
      `${totalTasks} quest${totalTasks === 1 ? "" : "s"} still open today. Even one small win builds momentum!`,
      "daily-summary",
    );
  }
}

async function spawnRecurringTasks() {
  try {
    const created = await spawnRecurringTasksForToday();
    if (created > 0) {
      logger.info({ created }, "Spawned recurring tasks for today");
    }
  } catch (err) {
    logger.error({ err }, "Failed to spawn recurring tasks");
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastSpawnDate: string | null = null;

export function startScheduler() {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(async () => {
    try {
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];

      if (lastSpawnDate !== todayStr) {
        lastSpawnDate = todayStr;
        await spawnRecurringTasks();
      } else {
        const minute = now.getMinutes();
        if (minute === 0) {
          await spawnRecurringTasks();
        }
      }

      await checkDueTasks();
      await sendDailySummary();
    } catch (err) {
      logger.error({ err }, "Scheduler error");
    }
  }, 60 * 1000);

  // Spawn immediately on startup for today
  spawnRecurringTasks().catch((err) => logger.error({ err }, "Initial spawn error"));

  logger.info("Notification scheduler started");
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
