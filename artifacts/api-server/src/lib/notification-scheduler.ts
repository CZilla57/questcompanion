import { eq, and, gt, desc, gte, isNotNull, or, isNull, lte, lt } from "drizzle-orm";
import {
  db, tasksTable, usersTable, activityTable, pushSubscriptionsTable, focusSessionsTable,
  brainCheckinsTable, reflectionsTable, weeklyRecapsTable, coinTransactionsTable,
  initiationAwardsTable, userBadgesTable, badgesTable, questlinesTable,
  worldBossAttacksTable, worldBossWeeksTable, type WeekStats,
} from "@workspace/db";
import { sendPushNotification } from "./push-notifications";
import { logger } from "./logger";
import { spawnRecurringTasksForToday } from "../routes/recurring-tasks";
import { hungerStage, hungerWarning, shouldSendFlavorPush } from "./hero-care";
import { currentVignette } from "./hero-flavor";
import { deriveBrainState } from "./brain-mode";
import { resolveTimeZone, localHour, localDateKey, localDayStartUtc } from "./date-buckets";
import { protectedStretch, selectProtectionNudge, type NudgeKind } from "./hyperfocus";
import { shouldPromptReflection } from "./reflections";
import { eligibleKinds, selectContextNudge } from "./context-nudges";
import { derivePatterns } from "./patterns";
import { loadPatternInputs } from "../routes/patterns";
import {
  previousLocalWeek, inRecapWindow, recapAction, buildWeekStats, isZeroSignal,
  recapSubject, type LocalWeek, type WeekStatsInputs,
} from "./weekly-recap";
import { draftNarrative } from "./ai/weekly-recap";
import { isRecapEmailConfigured, sendEmail } from "./email/send-email";
import { renderRecapEmail } from "./email/render-recap";
import { generateJson, isAiConfigured } from "./ai/client";

const DEFAULT_USER_ID = 1;

async function getSubscriptions(userId: number) {
  return db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId));
}

async function removeSubscription(endpoint: string) {
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
}

async function notify(userId: number, title: string, body: string, tag: string, data?: Record<string, unknown>) {
  const subs = await getSubscriptions(userId);
  for (const sub of subs) {
    const ok = await sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { title, body, tag, ...(data ? { data } : {}) },
    );
    if (!ok) {
      await removeSubscription(sub.endpoint);
    }
  }
}

async function checkContextNudges() {
  const now = new Date();
  const users = await db.select().from(usersTable);
  for (const user of users) {
    // One user's failure must not abort the pass; dedup gates make retries safe.
    try {
      const tz = resolveTimeZone(user.timezone ?? "");
      const localToday = localDateKey(now, tz);
      const gate = {
        now,
        localHour: localHour(now, tz),
        localToday,
        sentDates: {
          dueToday: user.nudgeDueTodayDate,
          powerWindow: user.nudgePowerWindowDate,
          quickWin: user.nudgeQuickWinDate,
        },
        contextNudgedAt: user.contextNudgedAt,
      };
      const kinds = eligibleKinds(gate);
      if (kinds.length === 0) continue;

      // Every kind needs an open quest — cheapest real query, gates the rest.
      const openQuests = await db
        .select({
          id: tasksTable.id,
          title: tasksTable.title,
          dueDate: tasksTable.dueDate,
          category: tasksTable.category,
          estimatedMinutes: tasksTable.estimatedMinutes,
          difficulty: tasksTable.difficulty,
          priority: tasksTable.priority,
        })
        .from(tasksTable)
        .where(and(
          eq(tasksTable.userId, user.id),
          eq(tasksTable.completed, false),
          or(isNull(tasksTable.dueDate), lte(tasksTable.dueDate, localToday)),
        ));
      if (openQuests.length === 0) continue;

      // due_today alone needs no patterns; skip the 4 pattern queries then.
      const needsPatterns = kinds.includes("power_window") || kinds.includes("quick_win");
      const patterns = needsPatterns
        ? derivePatterns(await loadPatternInputs(user.id, tz, now))
        : null;

      const nudge = selectContextNudge({ ...gate, patterns, openQuests });
      if (!nudge) continue;

      await notify(user.id, nudge.title, nudge.body, nudge.tag, { url: nudge.url });
      const dateColumn =
        nudge.kind === "due_today" ? { nudgeDueTodayDate: localToday }
        : nudge.kind === "power_window" ? { nudgePowerWindowDate: localToday }
        : { nudgeQuickWinDate: localToday };
      await db.update(usersTable)
        .set({ ...dateColumn, contextNudgedAt: now })
        .where(eq(usersTable.id, user.id));
    } catch (err) {
      logger.error({ err, userId: user.id }, "Context-nudge pass failed for user");
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

async function checkHyperfocusProtection() {
  const now = new Date();
  const users = await db.select().from(usersTable);
  for (const user of users) {
    try {
      const tz = resolveTimeZone(user.timezone ?? "");
      const [latest] = await db.select().from(brainCheckinsTable)
        .where(eq(brainCheckinsTable.userId, user.id))
        .orderBy(desc(brainCheckinsTable.createdAt), desc(brainCheckinsTable.id))
        .limit(1);
      const state = deriveBrainState(latest, now, tz);

      const sessions = await db.select().from(focusSessionsTable)
        .where(and(eq(focusSessionsTable.userId, user.id), eq(focusSessionsTable.status, "active")));

      const stretch = protectedStretch({
        activeSessions: sessions.map((s) => ({ startedAt: s.startedAt, lastIntervalAt: s.lastIntervalAt })),
        mode: state.mode,
        hyperfocusSince: state.mode === "hyperfocus" ? state.since : null,
        now,
      });

      const chosen = selectProtectionNudge({
        stretch, now, localHour: localHour(now, tz),
        lastNudgedAt: user.hyperfocusNudgedAt,
        lastKind: user.hyperfocusLastKind as NudgeKind | null,
        hungerStage: hungerStage(user.lastFedAt, now),
        pausedUntil: user.hyperfocusPausedUntil,
      });

      if (chosen) {
        await notify(user.id, chosen.title, chosen.body, chosen.tag);
        await db.update(usersTable)
          .set({ hyperfocusNudgedAt: now, hyperfocusLastKind: chosen.kind })
          .where(eq(usersTable.id, user.id));
      }
    } catch (err) {
      logger.error({ err, userId: user.id }, "Hyperfocus-protection pass failed for user");
    }
  }
}

async function checkReflectionPrompts() {
  const now = new Date();
  const users = await db.select().from(usersTable);
  for (const user of users) {
    try {
      // Cheap pre-gates to skip per-user queries; shouldPromptReflection stays
      // the tested authority on the full rule set.
      if (!user.timezone) continue; // no tz ⇒ can't compute a local evening (spec §6)
      const tz = resolveTimeZone(user.timezone);
      const hour = localHour(now, tz);
      const localToday = localDateKey(now, tz);
      if (hour < 19 || hour >= 22 || user.reflectionPromptedDate === localToday) continue;

      const dayStart = localDayStartUtc(localToday, tz);

      const [todayReflection] = await db.select({ answeredAt: reflectionsTable.answeredAt })
        .from(reflectionsTable)
        .where(and(eq(reflectionsTable.userId, user.id), eq(reflectionsTable.localDate, localToday)));

      const [completion] = await db.select({ id: tasksTable.id }).from(tasksTable)
        .where(and(
          eq(tasksTable.userId, user.id), eq(tasksTable.completed, true),
          isNotNull(tasksTable.completedAt), gte(tasksTable.completedAt, dayStart),
        )).limit(1);
      const [focus] = await db.select({ id: focusSessionsTable.id }).from(focusSessionsTable)
        .where(and(
          eq(focusSessionsTable.userId, user.id),
          gte(focusSessionsTable.startedAt, dayStart),
          gte(focusSessionsTable.completedIntervals, 1),
        )).limit(1);
      const [checkin] = await db.select({ id: brainCheckinsTable.id }).from(brainCheckinsTable)
        .where(and(eq(brainCheckinsTable.userId, user.id), gte(brainCheckinsTable.createdAt, dayStart)))
        .limit(1);

      const should = shouldPromptReflection({
        localHour: hour,
        promptedToday: user.reflectionPromptedDate === localToday,
        answeredToday: todayReflection?.answeredAt != null,
        hadSignalToday: Boolean(completion || focus || checkin),
        hasTimezone: true,
      });
      if (!should) continue;

      await notify(
        user.id,
        "🌙 How did today feel?",
        "1-minute reflection — what worked today?",
        "reflection-prompt",
        { url: "/reflection" },
      );
      await db.update(usersTable)
        .set({ reflectionPromptedDate: localToday })
        .where(eq(usersTable.id, user.id));
    } catch (err) {
      logger.error({ err, userId: user.id }, "Reflection-prompt pass failed for user");
    }
  }
}

async function spawnRecurringTasks() {
  const created = await spawnRecurringTasksForToday();
  if (created > 0) {
    logger.info({ created }, "Spawned recurring tasks for today");
  }
}

const APP_ORIGIN = process.env.APP_ORIGIN || "https://getfocusquest.com";

// Caps expensive generation work (stat queries + LLM draft) per tick. Keeps
// the every-minute tick well under the cron caller's ~30s window; remaining
// users are picked up by subsequent in-window ticks (spec §4 resume machine).
const MAX_GENERATE_PER_TICK = 3;

/** Raw rows for the closed local week. Personal stats use the user's local
 * Mon 00:00 → next Mon 00:00 instants; the World Boss block keys on the UTC
 * ISO week (how boss data is stored) — the 0-12h boundary mismatch is an
 * accepted spec tradeoff (spec §5). */
async function loadWeekStatsInputs(userId: number, tz: string, week: LocalWeek, now: Date): Promise<WeekStatsInputs> {
  const startUtc = localDayStartUtc(week.startDateKey, tz);
  const endUtc = localDayStartUtc(week.endDateKeyExclusive, tz);

  const completions = await db
    .select({ title: tasksTable.title, completedAt: tasksTable.completedAt })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.userId, userId), eq(tasksTable.completed, true),
      isNotNull(tasksTable.completedAt),
      gte(tasksTable.completedAt, startUtc), lt(tasksTable.completedAt, endUtc),
    ));

  const focus = await db
    .select({ focusedSeconds: focusSessionsTable.focusedSeconds })
    .from(focusSessionsTable)
    .where(and(
      eq(focusSessionsTable.userId, userId),
      gte(focusSessionsTable.startedAt, startUtc), lt(focusSessionsTable.startedAt, endUtc),
      // Opened-and-abandoned sessions (0 focused seconds) are not signal —
      // mirrors the reflections pass's completedIntervals gate.
      gt(focusSessionsTable.focusedSeconds, 0),
    ));

  const activityRows = await db
    .select({ type: activityTable.type, points: activityTable.points })
    .from(activityTable)
    .where(and(
      eq(activityTable.userId, userId),
      gte(activityTable.createdAt, startUtc), lt(activityTable.createdAt, endUtc),
    ));

  const coins = await db
    .select({ amount: coinTransactionsTable.amount })
    .from(coinTransactionsTable)
    .where(and(
      eq(coinTransactionsTable.userId, userId),
      gte(coinTransactionsTable.createdAt, startUtc), lt(coinTransactionsTable.createdAt, endUtc),
    ));

  const initiations = await db
    .select({ id: initiationAwardsTable.id })
    .from(initiationAwardsTable)
    .where(and(
      eq(initiationAwardsTable.userId, userId),
      gte(initiationAwardsTable.awardedAt, startUtc), lt(initiationAwardsTable.awardedAt, endUtc),
    ));

  const badgeRows = await db
    .select({ name: badgesTable.name })
    .from(userBadgesTable)
    .innerJoin(badgesTable, eq(userBadgesTable.badgeId, badgesTable.id))
    .where(and(
      eq(userBadgesTable.userId, userId),
      gte(userBadgesTable.earnedAt, startUtc), lt(userBadgesTable.earnedAt, endUtc),
    ));

  const questlines = await db
    .select({ title: questlinesTable.title })
    .from(questlinesTable)
    .where(and(
      eq(questlinesTable.userId, userId), isNotNull(questlinesTable.completedAt),
      gte(questlinesTable.completedAt, startUtc), lt(questlinesTable.completedAt, endUtc),
    ));

  const attacks = await db
    .select({ damage: worldBossAttacksTable.damage })
    .from(worldBossAttacksTable)
    .where(and(eq(worldBossAttacksTable.userId, userId), eq(worldBossAttacksTable.weekKey, week.weekKey)));

  const [bossWeek] = await db
    .select({ defeatedAt: worldBossWeeksTable.defeatedAt })
    .from(worldBossWeeksTable)
    .where(eq(worldBossWeeksTable.weekKey, week.weekKey));

  const patterns = derivePatterns(await loadPatternInputs(userId, tz, now));

  return {
    weekKey: week.weekKey,
    completions: completions.map((c) => ({ title: c.title, completedAt: c.completedAt! })),
    focusSessions: focus,
    xpEarned: activityRows.filter((a) => a.points > 0).reduce((s, a) => s + a.points, 0),
    levelUps: activityRows.filter((a) => a.type === "level_up").length,
    coinsEarned: coins.filter((c) => c.amount > 0).reduce((s, c) => s + c.amount, 0),
    initiations: initiations.length,
    badges: badgeRows.map((b) => b.name),
    questlinesCompleted: questlines.map((q) => q.title),
    bossAttacks: attacks,
    bossDefeated: bossWeek?.defeatedAt != null,
    patterns,
  };
}

async function checkWeeklyRecaps() {
  const now = new Date();
  const users = await db.select().from(usersTable);
  let generated = 0;
  for (const user of users) {
    try {
      if (!user.timezone) continue; // no tz ⇒ no local Monday (spec §4)
      const tz = resolveTimeZone(user.timezone);
      if (!inRecapWindow(now, tz)) continue;
      const week = previousLocalWeek(now, tz);

      // Atomic claim: the unique(userId, weekKey) insert IS the exactly-once
      // gate. Losing the race means resuming the winner's row (reflections
      // pattern). Generation runs regardless of email config — the in-app
      // archive always fills; only the send is gated (spec §4/§10).
      const [claimed] = await db.insert(weeklyRecapsTable)
        .values({ userId: user.id, weekKey: week.weekKey })
        .onConflictDoNothing()
        .returning();
      const [row] = claimed
        ? [claimed]
        : await db.select().from(weeklyRecapsTable)
            .where(and(eq(weeklyRecapsTable.userId, user.id), eq(weeklyRecapsTable.weekKey, week.weekKey)));
      if (!row) continue;

      if (recapAction(row) === "done") continue;

      let stats: WeekStats | null = row.stats;
      let subject = row.subject;
      let narrative = row.narrative;

      if (recapAction(row) === "generate") {
        // Per-tick cap on expensive generation (stat fan-out + LLM draft).
        // Send-only resumes below are NOT capped. The row stays claimed but
        // ungenerated — leave it for the next tick, the resume machine picks
        // it back up via recapAction (spec §4).
        if (generated >= MAX_GENERATE_PER_TICK) continue;

        const inputs = await loadWeekStatsInputs(user.id, tz, week, now);
        stats = buildWeekStats(inputs);
        generated++;
        if (isZeroSignal(stats)) {
          // Anti-shame silent skip: no email, no "quiet week" message, ever.
          await db.update(weeklyRecapsTable).set({ stats, skipped: true })
            .where(eq(weeklyRecapsTable.id, row.id));
          continue;
        }
        // LLM outside any tx; fallback-first (spec §6).
        const draft = await draftNarrative(stats, user.id, week.weekKey, isAiConfigured() ? generateJson : null);
        narrative = draft.narrative;
        subject = recapSubject(stats);
        await db.update(weeklyRecapsTable).set({ stats, subject, narrative })
          .where(eq(weeklyRecapsTable.id, row.id));
      }

      // Send gate: config + stored email + opt-in. A row left unsent here is
      // indistinguishable from a send failure — fine, the archive is the
      // source of truth (spec §10). Token is set whenever email is (auth.ts).
      if (!isRecapEmailConfigured() || !user.email || !user.recapEmailsEnabled || !user.recapUnsubscribeToken) continue;
      if (!stats || !subject || !narrative) continue;

      // Atomic claim before send: two overlapping ticks (e.g. a slow generate
      // straddling a cron boundary) must not both dispatch the same email.
      // Mirrors the reflections first-answer claim (routes/reflections.ts).
      const claimedSend = await db.update(weeklyRecapsTable)
        .set({ sentAt: now })
        .where(and(eq(weeklyRecapsTable.id, row.id), isNull(weeklyRecapsTable.sentAt)))
        .returning({ id: weeklyRecapsTable.id });
      if (claimedSend.length === 0) continue; // another tick already owns this send

      const unsubscribeUrl = `${APP_ORIGIN}/api/recaps/unsubscribe?token=${user.recapUnsubscribeToken}`;
      const { html, text } = renderRecapEmail(stats, narrative, unsubscribeUrl);
      try {
        await sendEmail({
          to: user.email, subject, html, text, unsubscribeUrl,
          idempotencyKey: `recap-${user.id}-${week.weekKey}`,
        });
      } catch (err) {
        // Best-effort un-claim so the next tick retries the send; rethrow so
        // the per-user catch below still logs the failure.
        await db.update(weeklyRecapsTable).set({ sentAt: null }).where(eq(weeklyRecapsTable.id, row.id));
        throw err;
      }
    } catch (err) {
      logger.error({ err, userId: user.id }, "Weekly-recap pass failed for user");
    }
  }
}

export async function tick() {
  const ran: string[] = [];

  await spawnRecurringTasks();
  ran.push("recurring-tasks");

  await checkContextNudges();
  ran.push("context-nudges");

  await sendDailySummary();
  ran.push("daily-summary");

  await checkHeroCare();
  ran.push("hero-care");

  await checkHyperfocusProtection();
  ran.push("hyperfocus-protection");

  await checkReflectionPrompts();
  ran.push("reflection-prompts");

  await checkWeeklyRecaps();
  ran.push("weekly-recaps");

  return ran;
}
