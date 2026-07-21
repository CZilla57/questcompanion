import { useState } from "react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Swords, Users, Coins } from "lucide-react";
import {
  useGetWorldBossCurrent,
  useAttackWorldBoss,
  getGetWorldBossCurrentQueryKey,
  getGetCoinsQueryKey,
  WorldBossAttackResultReason,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

/** Shared co-op raid card: everyone in the game chips away at one weekly World
 *  Boss. Mirrors BattlePanel's conventions (Card / useToast / useQueryClient /
 *  framer-motion) but the HP bar reflects the whole raid party's total damage,
 *  not just yours, and the attack is a once-per-day action. */
export function WorldBossPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: boss, isLoading } = useGetWorldBossCurrent();
  const attack = useAttackWorldBoss();
  const [rolled, setRolled] = useState<number | null>(null);

  if (isLoading || !boss) return null;

  const pct = boss.hp > 0 ? Math.min(100, Math.round((boss.totalDamage / boss.hp) * 100)) : 0;
  const canAttack = !boss.defeated && !boss.attackedToday && !attack.isPending;
  const attackXp = boss.attackXp;

  async function onAttack() {
    try {
      const res = await attack.mutateAsync();
      if (!res.attacked) {
        const alreadyDefeated = res.reason === WorldBossAttackResultReason.defeated;
        toast({
          title: alreadyDefeated ? "Already felled 🎉" : "Attack ready tomorrow",
          description: alreadyDefeated
            ? "The World Boss is down for this week."
            : "You've already struck today — come back tomorrow.",
        });
      } else {
        const dealt = res.damage ?? 0;
        setRolled(dealt);
        if (res.justDefeated) {
          toast({
            title: "World Boss felled! 🎉",
            description: `+${res.coinsAwarded} coins & bonus XP to every raider!`,
            className: "border-primary",
          });
          await qc.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
        } else {
          toast({ title: `Hit for ${dealt}!`, description: `+${attackXp} XP for joining the raid.` });
        }
      }
      await qc.invalidateQueries({ queryKey: getGetWorldBossCurrentQueryKey() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast({ title: "Raid error", description: msg, variant: "destructive" });
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Swords className="w-5 h-5 text-red-400" />
          <div>
            <h3 className="font-bold text-lg">World Boss</h3>
            <p className="text-sm text-muted-foreground">{boss.weekKey} · this week&rsquo;s raiders vs. one boss</p>
          </div>
        </div>
        {boss.defeated && <span className="text-sm font-bold text-primary">Defeated 🎉</span>}
      </div>

      {/* Shared HP bar */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-muted-foreground">{pct}% felled this week</span>
          <span className="font-medium">{boss.totalDamage.toLocaleString()} / {boss.hp.toLocaleString()}</span>
        </div>
        <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-red-400"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
      </div>

      {rolled !== null && !boss.defeated && (
        <p className="text-sm text-center text-muted-foreground">
          You dealt <span className="font-bold text-foreground">{rolled}</span> damage!
        </p>
      )}

      <Button className="w-full" disabled={!canAttack} onClick={onAttack}>
        {boss.defeated
          ? "Boss defeated"
          : boss.attackedToday
          ? "Attack ready tomorrow"
          : attack.isPending
          ? "Attacking…"
          : `Attack (power ${boss.yourPower})`}
      </Button>

      {/* Raid party */}
      <div className="space-y-1">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Users className="w-4 h-4" /> Raid party
        </div>
        {boss.contributors.length === 0 && (
          <p className="text-xs text-muted-foreground">Be the first to strike this week!</p>
        )}
        {boss.contributors.map((c) => (
          <div key={c.userId} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: c.avatarColor }} />
              {c.displayName}
              {c.isAlly && <span className="text-xs text-primary">· ally</span>}
            </span>
            <span className="font-medium">{c.damage.toLocaleString()}</span>
          </div>
        ))}
      </div>

      <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
        <Coins className="w-3 h-3" /> Fell it together for +{boss.defeatCoins} coins &amp; +{boss.defeatXp} XP each
      </p>
    </Card>
  );
}
