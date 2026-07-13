import { useState } from "react";
import { useSendNudge, getGetPartnersQueryKey } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { reactionsFor, type NudgeKind } from "@/lib/nudge-reactions";
import { Hand, PartyPopper } from "lucide-react";

/** Pull a human-readable message out of an API error, falling back if absent. */
function nudgeError(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown } | null)?.data;
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  return fallback;
}

export function NudgePicker({
  partnerId, kind, disabled, emphasized, onSent,
}: {
  partnerId: number;
  kind: NudgeKind;
  disabled?: boolean;
  emphasized?: boolean;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const sendNudge = useSendNudge();

  const label = kind === "poke" ? "Poke" : "Cheer";
  const Icon = kind === "poke" ? Hand : PartyPopper;

  const handlePick = (reaction: string) => {
    sendNudge.mutate({ id: partnerId, data: { kind, reaction } }, {
      onSuccess: () => {
        toast({ title: kind === "poke" ? "Poke sent!" : "Cheer sent!" });
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetPartnersQueryKey() });
        onSent?.();
      },
      onError: (err) => {
        setOpen(false);
        toast({ title: "Couldn't send", description: nudgeError(err, "Please try again."), variant: "destructive" });
      },
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={emphasized ? "default" : "outline"}
          disabled={disabled || sendNudge.isPending}
          className={emphasized ? "" : "border-primary/40 text-primary hover:bg-primary/10"}
        >
          <Icon className="w-4 h-4 mr-1.5" /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1.5">
        <div className="flex flex-col gap-1">
          {reactionsFor(kind).map((r) => (
            <button
              key={r.key}
              onClick={() => handlePick(r.key)}
              disabled={sendNudge.isPending}
              className="text-left text-sm px-3 py-2 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
            >
              {r.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
