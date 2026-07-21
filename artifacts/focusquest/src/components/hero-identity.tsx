// Gentle Door: the hero's name with a quiet rename affordance. Cooldown state
// comes from GET /users/me (renameAvailableAt) so the dialog can say when the
// door reopens without ever surfacing an error wall.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, useUpdateMe, getGetMeQueryKey, getGetMyStatsQueryKey, ApiError } from "@workspace/api-client-react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { heroNameError } from "@/lib/username";

export function HeroIdentity() {
  const { data: me } = useGetMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const updateMe = useUpdateMe();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;

  const cooldownUntil = me.renameAvailableAt ? new Date(me.renameAvailableAt) : null;
  const onCooldown = cooldownUntil !== null && cooldownUntil.getTime() > Date.now();

  const openDialog = () => {
    setName(me.username);
    setError(null);
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === me.username) { setOpen(false); return; }
    const msg = heroNameError(trimmed);
    if (msg) { setError(msg); return; }
    try {
      await updateMe.mutateAsync({ data: { username: trimmed } });
      await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
      setOpen(false);
      toast({ title: `You are now ${trimmed}!`, className: "border-primary" });
    } catch (err: unknown) {
      const status = err instanceof ApiError ? err.status : null;
      setError(
        status === 409
          ? "That hero name is already taken. Try another."
          : status === 429
          ? "Renamed recently — you can rename again soon."
          : status === 400
          ? "Hero names are 3–20 characters: letters, numbers, and underscores."
          : "Something went wrong. Please try again.",
      );
    }
  };

  return (
    <div className="flex items-center gap-2">
      <h2 className="text-lg font-bold text-foreground">{me.username}</h2>
      <Button variant="ghost" size="icon" aria-label="Rename hero" className="text-muted-foreground h-7 w-7" onClick={openDialog}>
        <Pencil className="w-3.5 h-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm bg-card border-primary/30">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-primary">Rename your hero</DialogTitle>
          </DialogHeader>
          {onCooldown ? (
            <p className="text-sm text-muted-foreground py-2">
              You can rename again on {cooldownUntil!.toLocaleDateString(undefined, { month: "long", day: "numeric" })}.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-3 mt-2">
              <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} maxLength={20} autoFocus aria-label="Hero name" aria-invalid={!!error} aria-describedby={error ? "rename-error" : undefined} />
              <p className="text-xs text-muted-foreground">3–20 characters, letters, numbers, and underscores. You can rename once a week.</p>
              {error && <p id="rename-error" className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={updateMe.isPending || name.trim().length === 0}>
                  {updateMe.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
