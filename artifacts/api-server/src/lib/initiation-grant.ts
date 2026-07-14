import { and, desc, eq } from "drizzle-orm";
import { db, activityTable, initiationAwardsTable, questlinesTable, usersTable, type User } from "@workspace/db";
import { evaluateInitiationAwards, toInitiationXp, type InitiationEvent, type InitiationXp } from "./initiation";
import { resolveTimeZone, localDateKey, localDayStartUtc } from "./date-buckets";
import { getLevelInfo } from "./gamification";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Evaluate and apply initiation awards inside the caller's transaction.
 *
 * The caller MUST hold the user row FOR UPDATE in `tx` — that serializes the
 * time-window guards (cooldown, first-move). The once-ever kinds are also
 * guarded by the (user_id, kind, ref_id) unique index: the ledger insert uses
 * onConflictDoNothing and only pays when a row was actually inserted, so a
 * lost race can never double-pay or error.
 */
export async function grantInitiationAwards(
  tx: Tx,
  user: User,
  event: InitiationEvent,
  tz: string | undefined,
): Promise<InitiationXp> {
  const now = new Date();
  const timeZone = resolveTimeZone(tz);
  const dayStartUtc = localDayStartUtc(localDateKey(now, timeZone), timeZone);

  const latestOf = async (kind: string) => {
    const [row] = await tx.select().from(initiationAwardsTable)
      .where(and(eq(initiationAwardsTable.userId, user.id), eq(initiationAwardsTable.kind, kind)))
      .orderBy(desc(initiationAwardsTable.awardedAt))
      .limit(1);
    return row ?? null;
  };
  const refAwarded = async (kind: string, refId: number) => {
    const [row] = await tx.select().from(initiationAwardsTable)
      .where(and(
        eq(initiationAwardsTable.userId, user.id),
        eq(initiationAwardsTable.kind, kind),
        eq(initiationAwardsTable.refId, refId),
      ))
      .limit(1);
    return !!row;
  };

  const lastStart = event.type === "session_start" ? await latestOf("session_start") : null;
  const lastFirstMove = await latestOf("first_move");

  let taskFirstStepAwarded = false;
  let questlineKickoffAwarded = false;
  let questlineTitle: string | null = null;
  if (event.task) {
    if (event.type === "step_check") {
      taskFirstStepAwarded = await refAwarded("first_step", event.task.id);
    }
    if (event.task.questlineId != null) {
      questlineKickoffAwarded = await refAwarded("questline_kickoff", event.task.questlineId);
      if (!questlineKickoffAwarded) {
        const [ql] = await tx.select().from(questlinesTable)
          .where(and(eq(questlinesTable.id, event.task.questlineId), eq(questlinesTable.userId, user.id)))
          .limit(1);
        questlineTitle = ql?.title ?? null;
      }
    }
  }

  const granted = evaluateInitiationAwards(event, {
    lastSessionStartAwardAt: lastStart?.awardedAt ?? null,
    taskFirstStepAwarded,
    questlineKickoffAwarded,
    lastFirstMoveAt: lastFirstMove?.awardedAt ?? null,
    dayStartUtc,
    questlineTitle,
  }, now);

  const applied: typeof granted = [];
  for (const g of granted) {
    const inserted = await tx.insert(initiationAwardsTable)
      .values({ userId: user.id, kind: g.kind, refId: g.refId, awardedAt: now })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) continue; // lost a once-ever race — skip the pay
    await tx.insert(activityTable).values({
      userId: user.id,
      type: "initiation",
      description: g.description,
      points: g.points,
    });
    applied.push(g);
  }

  const total = applied.reduce((sum, g) => sum + g.points, 0);
  if (total > 0) {
    // Keep the stored level in sync, matching the task/gear/battle XP writes.
    const newTotal = user.totalPoints + total;
    await tx.update(usersTable).set({
      totalPoints: newTotal,
      weeklyPoints: user.weeklyPoints + total,
      currentLevel: getLevelInfo(newTotal).level,
    }).where(eq(usersTable.id, user.id));
  }

  return toInitiationXp(applied);
}
