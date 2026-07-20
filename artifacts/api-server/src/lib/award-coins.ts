import { and, eq, gte, sql } from "drizzle-orm";
import { db, usersTable, coinTransactionsTable, type CoinReason } from "@workspace/db";
import { coinsToReverse } from "./coins";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Credit coins to a user inside the caller's transaction: bump the denormalized
 * balance and append one ledger row. No-op for non-positive amounts. Earns are
 * always positive, so this can never drive the balance negative.
 */
export async function awardCoins(
  tx: Tx,
  userId: number,
  amount: number,
  reason: CoinReason,
): Promise<void> {
  if (amount <= 0) return;
  await tx.update(usersTable)
    .set({ coinBalance: sql`${usersTable.coinBalance} + ${amount}` })
    .where(eq(usersTable.id, userId));
  await tx.insert(coinTransactionsTable).values({ userId, amount, reason });
}

/**
 * Reverse a prior coin award inside the caller's transaction. The caller MUST hold
 * the user row FOR UPDATE (the uncomplete handler does), so this read-then-write is
 * race-safe. Clamps to the current balance so it can never go negative, and records
 * the ACTUAL amount removed as a ledger row so `balance == sum(ledger)` is preserved.
 */
export async function reverseCoins(
  tx: Tx,
  userId: number,
  amount: number,
  reason: CoinReason,
): Promise<void> {
  if (amount <= 0) return;
  const [user] = await tx
    .select({ balance: usersTable.coinBalance })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const removed = coinsToReverse(amount, user?.balance ?? 0);
  if (removed <= 0) return;
  await tx.update(usersTable)
    .set({ coinBalance: sql`${usersTable.coinBalance} - ${removed}` })
    .where(eq(usersTable.id, userId));
  await tx.insert(coinTransactionsTable).values({ userId, amount: -removed, reason });
}

export type SpendResult =
  | { ok: true; balance: number }
  | { ok: false; balance: number; remaining: number };

/**
 * Spend coins inside the caller's transaction — the one spend grammar
 * (Honest Coin): a single atomic guarded decrement that only fires when the
 * balance covers the cost (can never go negative; a concurrent double-spend
 * can't overspend) plus exactly one negative ledger row. Insufficiency is a
 * value, not an error: {ok:false, remaining} feeds the gentle "N more to go".
 * No-ops (returning the current balance, no ledger row) on non-positive cost —
 * a spend can never mint.
 */
export async function spendCoins(
  tx: Tx,
  userId: number,
  cost: number,
  reason: CoinReason,
  opts?: { rewardItemId?: number },
): Promise<SpendResult> {
  // Spends are always positive; a non-positive cost is a caller bug. No-op
  // (mirroring awardCoins) so this primitive can never mint coins or write
  // phantom ledger rows.
  if (cost <= 0) {
    const [u] = await tx
      .select({ balance: usersTable.coinBalance })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    return { ok: true, balance: u?.balance ?? 0 };
  }

  const [updated] = await tx
    .update(usersTable)
    .set({ coinBalance: sql`${usersTable.coinBalance} - ${cost}` })
    .where(and(eq(usersTable.id, userId), gte(usersTable.coinBalance, cost)))
    .returning({ balance: usersTable.coinBalance });

  if (!updated) {
    const [u] = await tx
      .select({ balance: usersTable.coinBalance })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    const bal = u?.balance ?? 0;
    return { ok: false, balance: bal, remaining: Math.max(0, cost - bal) };
  }

  await tx.insert(coinTransactionsTable).values({
    userId,
    amount: -cost,
    reason,
    rewardItemId: opts?.rewardItemId,
  });
  return { ok: true, balance: updated.balance };
}
