import { useQueryClient } from "@tanstack/react-query";
import {
  useBuyStatPerk,
  getGetStatPerksQueryKey,
  getGetCoinsQueryKey,
  getGetMyStatsQueryKey,
  type StatPerk,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";

// Celebratory copy per perk on a successful buy (anti-shame: buying is delight).
const BOUGHT_TITLE: Record<string, string> = {
  xp_boost: "XP Boost active! ⚡",
  focus_boost: "Focus Boost active! 🎯",
  streak_shield: "Streak Shield ready 🛡️",
};

/** The one perk buy path for every surface (Power-Ups grid, /progress shield
 * card): mutation + invalidation + the perk toast grammar (bought /
 * fully-shielded reassurance / "N more to go"). */
export function useBuyPerk() {
  const buyMutation = useBuyStatPerk();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const buy = (perk: Pick<StatPerk, "id" | "description">) => {
    buyMutation.mutate(
      { id: perk.id },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetStatPerksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() }); // streak-freeze count surfaces here
          if (res.purchased) {
            toast({ title: BOUGHT_TITLE[perk.id] ?? "Perk bought!", description: perk.description });
          } else if (res.reason === "at_max") {
            toast({ title: "You're fully shielded 🛡️", description: "Use one before stocking up again." });
          } else {
            toast({ title: `${res.remaining} more to go`, description: "Keep going — you're close." });
          }
        },
        onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't buy perk"), variant: "destructive" }),
      },
    );
  };

  return { buy, isPending: buyMutation.isPending };
}
