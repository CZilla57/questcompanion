import { eq, and, gt } from "drizzle-orm";
import { db, tasksTable, usersTable, activityTable, pushSubscriptionsTable } from "@workspace/db";
import { sendPushNotification } from "./push-notifications";
import { logger } from "./logger";
import { spawnRecurringTasksForToday } from "../routes/recurring-tasks";
import { hungerStage, hungerWarning, shouldSendFlavorPush } from "./hero-care";
import { currentVignette } from "./hero-flavor";

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

  const allTodayTasks = await db.select().from(tasksTable).where(
    and(eq(tasksTable.userId, DEFAULT_USER_ID), eq(tasksTable.dueDate, today)),
  );

  const completedToday = allTodayTasks.filter((t) => t.completed);
  const totalTasks = allTodayTasks.length;
  const doneCount = completedToday.length;
  const remainingCount = totalTasks - doneCount;

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

  if (totalTasks > 0 && doneCount > 0 && remainingCount > 0) {
    const xpLine = xpToday > 0 ? ` · ${xpToday} XP earned` : "";
    const streakLine = streakSafe ? ` Streak safe (${streakDays}d).` : " A quick quest keeps the momentum going.";
    await notify(
      DEFAULT_USER_ID,
      "Evening Debrief",
      `${doneCount}/${totalTasks} quests done${xpLine}. ${remainingCount} remaining —${streakLine}`,
      "daily-summary",
    );
    return;
  }

  if (doneCount === 0 && streakDays > 0) {
    const taskLine = totalTasks > 0
      ? ` You have ${totalTasks} quest${totalTasks === 1 ? "" : "s"} open.`
      : "";
    await notify(
      DEFAULT_USER_ID,
      "Keep the flame going 🔥",
      `Your ${streakDays}-day streak is one small quest away from continuing.${taskLine}`,
      "daily-summary",
    );
    return;
  }

  if (doneCount === 0 && totalTasks > 0) {
    await notify(
      DEFAULT_USER_ID,
      "Quest Log Waiting",
      `${totalTasks} quest${totalTasks === 1 ? "" : "s"} still open today. Even one small win builds momentum!`,
      "daily-summary",
    );
  }
}

async function checkHeroCare() {
  const now = new Date();
  const hour = now.getHours();
  if (hour < 7 || hour >= 22) return;

  // Hero care is per-user (unlike the legacy DEFAULT_USER_ID passes above).
  const users = await db.select().from(usersTable);
  for (const user of users) {
    // One user's failure (e.g. a transient DB error) must not abort the pass
    // for everyone else; dedup gates make the next tick's retry safe.
    try {
      const stage = hungerStage(user.lastFedAt, now);

      // Hunger warnings: once per stage per episode. Recorded even for users
      // with no push subscriptions (notify() no-ops) so in-app state stays the
      // source of truth and a late subscription doesn't trigger stale warnings.
      const warning = hungerWarning(stage, user.hungerNotifiedStage);
      if (warning) {
        await notify(user.id, warning.title, warning.body, warning.tag);
        await db.update(usersTable)
          .set({ hungerNotifiedStage: stage })
          .where(eq(usersTable.id, user.id));
        continue; // a warning and a flavor push never share a tick
      }

      if (shouldSendFlavorPush({ userId: user.id, stage, lastFlavorPushAt: user.lastFlavorPushAt, now })) {
        const vignette = currentVignette(user.id, stage, user.avatarClass, now);
        await notify(user.id, "Word from your hero", `Your hero is ${vignette.text}.`, "hero-flavor");
        await db.update(usersTable)
          .set({ lastFlavorPushAt: now })
          .where(eq(usersTable.id, user.id));
      }
    } catch (err) {
      logger.error({ err, userId: user.id }, "Hero-care pass failed for user");
    }
  }
}

async function spawnRecurringTasks() {
  const created = await spawnRecurringTasksForToday();
  if (created > 0) {
    logger.info({ created }, "Spawned recurring tasks for today");
  }
}

export async function tick() {
  const ran: string[] = [];

  await spawnRecurringTasks();
  ran.push("recurring-tasks");

  await checkDueTasks();
  ran.push("check-due-tasks");

  await sendDailySummary();
  ran.push("daily-summary");

  await checkHeroCare();
  ran.push("hero-care");

  return ran;
}
