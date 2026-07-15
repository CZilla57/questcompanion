import { eq, sql } from "drizzle-orm";
import { db, usersTable, coinTransactionsTable, type CoinReason } from "@workspace/db";

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
