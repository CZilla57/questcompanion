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
import { companionMilestonePush } from "./companion";
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
import {
  selectPush,
  type PushCandidate, type EnvelopeState,
} from "./notification-envelope";
import type { User } from "@workspace/db";

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

type ProducedCandidate = PushCandidate & { commit: () => Promise<void> };

async function contextNudgeCandidate(user: User, now: Date): Promise<ProducedCandidate | null> {
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
  if (kinds.length === 0) return null;

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
  if (openQuests.length === 0) return null;

  const needsPatterns = kinds.includes("power_window") || kinds.includes("quick_win");
  const patterns = needsPatterns
    ? derivePatterns(await loadPatternInputs(user.id, tz, now))
    : null;

  const nudge = selectContextNudge({ ...gate, patterns, openQuests });
  if (!nudge) return null;

  return {
    kind: "context_nudge",
    title: nudge.title, body: nudge.body, tag: nudge.tag, url: nudge.url,
    commit: async () => {
      const dateColumn =
        nudge.kind === "due_today" ? { nudgeDueTodayDate: localToday }
        : nudge.kind === "power_window" ? { nudgePowerWindowDate: localToday }
        : { nudgeQuickWinDate: localToday };
      await db.update(usersTable)
        .set({ ...dateColumn, contextNudgedAt: now })
        .where(eq(usersTable.id, user.id));
    },
  };
}

async function heroCareCandidate(user: User, now: Date): Promise<ProducedCandidate | null> {
  // No hour gate here: the envelope enforces windows in the user's own timezone.
  const stage = hungerStage(user.lastFedAt, now);

  const warning = hungerWarning(stage, user.hungerNotifiedStage);
  if (warning) {
    return {
      kind: "hunger_warning",
      title: warning.title, body: warning.body, tag: warning.tag,
      commit: async () => {
        await db.update(usersTable)
          .set({ hungerNotifiedStage: stage })
          .where(eq(usersTable.id, user.id));
      },
    };
  }

  const milestone = companionMilestonePush(user.streakDays, user.companionMilestoneNotified);
  if (milestone.push) {
    const push = milestone.push;
    return {
      kind: "companion_milestone",
      title: push.title, body: push.body, tag: push.tag,
      commit: async () => {
        await db.update(usersTable)
          .set({ companionMilestoneNotified: milestone.marker })
          .where(eq(usersTable.id, user.id));
      },
    };
  }
  if (milestone.marker !== user.companionMilestoneNotified) {
    // Maintenance, not a send: streak broke — clear so it can re-celebrate later.
    await db.update(usersTable)
      .set({ companionMilestoneNotified: milestone.marker })
      .where(eq(usersTable.id, user.id));
  }

  if (shouldSendFlavorPush({ userId: user.id, stage, lastFlavorPushAt: user.lastFlavorPushAt, now })) {
    const vignette = currentVignette(user.id, stage, user.avatarClass, now);
    return {
      kind: "hero_flavor",
      title: "Word from your hero", body: `Your hero is ${vignette.text}.`, tag: "hero-flavor",
      commit: async () => {
        await db.update(usersTable)
          .set({ lastFlavorPushAt: now })
          .where(eq(usersTable.id, user.id));
      },
    };
  }
  return null;
}

async function hyperfocusCandidate(user: User, now: Date): Promise<ProducedCandidate | null> {
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
  if (!chosen) return null;

  return {
    kind: "hyperfocus",
    title: chosen.title, body: chosen.body, tag: chosen.tag,
    commit: async () => {
      await db.update(usersTable)
        .set({ hyperfocusNudgedAt: now, hyperfocusLastKind: chosen.kind })
        .where(eq(usersTable.id, user.id));
    },
  };
}

async function reflectionCandidate(user: User, now: Date): Promise<ProducedCandidate | null> {
  if (!user.timezone) return null;
  const tz = resolveTimeZone(user.timezone);
  const hour = localHour(now, tz);
  const localToday = localDateKey(now, tz);
  if (hour < 19 || hour >= 22 || user.reflectionPromptedDate === localToday) return null;

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
  if (!should) return null;

  return {
    kind: "reflection_prompt",
    title: "🌙 How did today feel?",
    body: "1-minute reflection — what worked today?",
    tag: "reflection-prompt",
    url: "/reflection",
    commit: async () => {
      await db.update(usersTable)
        .set({ reflectionPromptedDate: localToday })
        .where(eq(usersTable.id, user.id));
    },
  };
}

async function runEnvelopePass(users: User[], now: Date) {
  for (const user of users) {
    try {
      const candidates: ProducedCandidate[] = [];
      // Producer order = tie-break order within a class (envelope sort is stable):
      // protection first, then care warning, context, reflection, milestone, flavor.
      const producers = [hyperfocusCandidate, heroCareCandidate, contextNudgeCandidate, reflectionCandidate];
      for (const produce of producers) {
        try {
          const c = await produce(user, now);
          if (c) candidates.push(c);
        } catch (err) {
          logger.error({ err, userId: user.id }, "Notification producer failed for user");
        }
      }
      if (candidates.length === 0) continue;

      const tz = resolveTimeZone(user.timezone ?? "");
      const localToday = localDateKey(now, tz);
      const state: EnvelopeState = {
        localHour: localHour(now, tz),
        localToday,
        prefs: {
          protection: user.notifyProtection,
          reminders: user.notifyReminders,
          reflection: user.notifyReflection,
          hero: user.notifyHero,
          quietHoursStart: user.quietHoursStart,
          quietHoursEnd: user.quietHoursEnd,
        },
        pushesSentDate: user.pushesSentDate,
        pushesSentCount: user.pushesSentCount,
        lastPushAt: user.lastPushAt,
        now,
      };
      const winner = selectPush(candidates, state);
      if (!winner) continue;

      const produced = candidates.find((c) => c === winner)!;
      await notify(user.id, produced.title, produced.body, produced.tag, produced.url ? { url: produced.url } : undefined);
      await produced.commit();
      const sentToday = user.pushesSentDate === localToday ? user.pushesSentCount : 0;
      await db.update(usersTable)
        .set({ pushesSentDate: localToday, pushesSentCount: sentToday + 1, lastPushAt: now })
        .where(eq(usersTable.id, user.id));
    } catch (err) {
      logger.error({ err, userId: user.id }, "Envelope pass failed for user");
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

async function checkWeeklyRecaps(users: User[]) {
  const now = new Date();
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
  const now = new Date();

  await spawnRecurringTasks();
  ran.push("recurring-tasks");

  // One shared users fetch per tick — passes must not re-scan the table.
  const users = await db.select().from(usersTable);

  await runEnvelopePass(users, now);
  ran.push("notification-envelope");

  await checkWeeklyRecaps(users);
  ran.push("weekly-recaps");

  return ran;
}
