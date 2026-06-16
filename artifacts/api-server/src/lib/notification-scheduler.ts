import { eq, and, desc } from "drizzle-orm";
import { db, tasksTable, usersTable, pushSubscriptionsTable } from "@workspace/db";
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

async function checkStreakReminder() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  if (currentHour !== 21 || currentMinute !== 0) return;

  const today = now.toISOString().split("T")[0];
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, DEFAULT_USER_ID));
  if (!user) return;

  const completedToday = await db.select().from(tasksTable).where(
    and(eq(tasksTable.userId, DEFAULT_USER_ID), eq(tasksTable.dueDate, today), eq(tasksTable.completed, true)),
  );

  if (completedToday.length === 0 && user.streakDays > 0) {
    await notify(
      DEFAULT_USER_ID,
      "Streak at Risk!",
      `Your ${user.streakDays}-day streak is on the line. Complete at least one quest before midnight to keep it alive!`,
      "streak-warning",
    );
  }
}

async function spawnRecurringTasks() {
  const now = new Date();

  // Spawn recurring tasks once per minute check — only run at the task's configured time (within the same minute)
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

      // Spawn recurring tasks once per day at the top of each hour (checking all templates)
      // The actual per-template time check happens inside spawnRecurringTasksForToday
      if (lastSpawnDate !== todayStr) {
        lastSpawnDate = todayStr;
        await spawnRecurringTasks();
      } else {
        // Also check every hour in case new templates were added mid-day
        const minute = now.getMinutes();
        if (minute === 0) {
          await spawnRecurringTasks();
        }
      }

      await checkDueTasks();
      await checkStreakReminder();
    } catch (err) {
      logger.error({ err }, "Scheduler error");
    }
  }, 60 * 1000);

  // Also spawn immediately on startup for today
  spawnRecurringTasks().catch((err) => logger.error({ err }, "Initial spawn error"));

  logger.info("Notification scheduler started");
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
