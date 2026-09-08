import { useQueryClient } from "@tanstack/react-query";
import {
  useGetConsumables,
  useBuyConsumable,
  useActivateConsumable,
  getGetConsumablesQueryKey,
  getGetCoinsQueryKey,
  type ConsumableItem,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";

type ConsumableId = ConsumableItem["id"];

/** The one place the consumables surface reads its data and drives buy/queue.
 * Buying and queueing are pure delight (anti-shame): a failed buy is a gentle
 * "N more to go", never an error, and queueing one boosts only the next roll. */
export function useConsumables() {
  const { data, isLoading } = useGetConsumables();
  const buyMutation = useBuyConsumable();
  const activateMutation = useActivateConsumable();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetConsumablesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
  };

  const buy = (item: ConsumableItem) => {
    buyMutation.mutate(
      { id: item.id },
      {
        onSuccess: (res) => {
          refresh();
          if (res.purchased) {
            toast({ title: `${item.emoji} ${item.name} added`, description: "Queue it to ride your next quest's roll." });
          } else {
            toast({ title: `${res.remaining} more to go`, description: "Keep going — you're close." });
          }
        },
        onError: (err: unknown) => toast({ title: apiErrorMessage(err, "Couldn't buy that"), variant: "destructive" }),
      },
    );
  };

  // Queue an item for the next roll, or pass null to clear the current queue.
  const activate = (item: ConsumableItem | null) => {
    const id: ConsumableId | "none" = item ? item.id : "none";
    activateMutation.mutate(
      { id },
      {
        onSuccess: () => {
          refresh();
          if (item) {
            toast({ title: `${item.emoji} ${item.name} queued`, description: "It'll boost your next quest's roll." });
          } else {
            toast({ title: "Queue cleared", description: "No consumable on your next roll." });
          }
        },
        onError: (err: unknown) => toast({ title: apiErrorMessage(err, "Couldn't queue that"), variant: "destructive" }),
      },
    );
  };

  return {
    items: data?.items ?? [],
    pending: data?.pending ?? null,
    isLoading,
    buy,
    activate,
    isBuying: buyMutation.isPending,
    isActivating: activateMutation.isPending,
  };
}
