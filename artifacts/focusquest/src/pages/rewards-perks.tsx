import { useGetCoins } from "@workspace/api-client-react";
import { StatPerksSection } from "@/components/stat-perks-section";
import { PageTabs } from "@/components/page-tabs";
import { Coins, Zap } from "lucide-react";

export default function RewardsPerks() {
  const { data: coins } = useGetCoins();
  const balance = coins?.balance ?? 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-xl">
      <PageTabs group="rewards" />
      {/* Header + balance */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center">
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">Power-Ups</h1>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300">
            <Coins className="w-4 h-4" />
            <span className="font-semibold tabular-nums">{balance}</span>
          </div>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Spend coins to play stronger. Boosts stack their timer; nothing here ever costs you XP or a streak.
        </p>
      </div>

      <StatPerksSection hideHeader />
    </div>
  );
}
