import { eq, sql } from "drizzle-orm";
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
