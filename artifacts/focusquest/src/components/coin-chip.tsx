import { Coins } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useGetCoins, useGetMyStats, getGetCoinsQueryKey } from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { isUnlocked } from "@/lib/feature-gates";

/** Header readout of the user's spendable coin balance. Rolls the number on
 *  change so earns get a small, satisfying acknowledgement without a toast. */
export function CoinChip() {
  const { data: stats } = useGetMyStats({ tz: browserTimeZone() });
  const rewardsUnlocked = isUnlocked(stats?.unlockedFeatures, "rewards");
  const { data } = useGetCoins({
    query: { enabled: rewardsUnlocked, queryKey: getGetCoinsQueryKey() },
  });
  // Coins EARN silently from L1 (server untouched); only the display waits for
  // the L6 reveal so the wallet is full when the door opens.
  if (!rewardsUnlocked) return null;
  const balance = data?.balance ?? 0;

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300"
      aria-label={`${balance} coins`}
      title={`${balance} coins`}
    >
      <Coins className="w-4 h-4 flex-shrink-0" />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={balance}
          initial={{ y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 8, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="text-sm font-semibold tabular-nums leading-none"
        >
          {balance}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
