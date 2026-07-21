import { useState } from "react";
import { Settings, Download, ShieldAlert } from "lucide-react";
import { useDeleteMe } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { confirmPhraseOk, DELETE_PHRASE } from "@/lib/account";

/** Account settings + Danger zone (Act VII q7). Plain copy, no dark patterns:
 * export is one tap, deletion is honest about being unrecoverable and takes a
 * typed phrase — friction, not guilt. */
export function AccountDialog() {
  const { toast } = useToast();
  const del = useDeleteMe();
  const [phrase, setPhrase] = useState("");

  async function onDelete() {
    try {
      await del.mutateAsync({ data: { confirm: DELETE_PHRASE } });
      // Session is gone server-side; a hard navigation lands on the login screen.
      window.location.href = "/";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast({ title: "Couldn't delete the account", description: msg, variant: "destructive" });
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account settings" className="text-muted-foreground">
          <Settings className="w-5 h-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Your account</DialogTitle>
          <DialogDescription>Your data belongs to you — take it or erase it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Download className="w-4 h-4" /> Export your data
          </div>
          <p className="text-xs text-muted-foreground">
            One JSON file with everything: quests, check-ins, reflections, coins, hero, history.
          </p>
          <Button asChild variant="outline" size="sm">
            <a href="/api/me/export" download>Download export</a>
          </Button>
        </div>

        <div className="space-y-2 border border-destructive/40 rounded-lg p-3 mt-2">
          <div className="text-sm font-semibold text-destructive flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Danger zone
          </div>
          <p className="text-xs text-muted-foreground">
            Deleting your account erases everything above, on every device, permanently.
            There is no recovery. Export first if you want a copy.
          </p>
          <Input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder={`Type "${DELETE_PHRASE}" to enable`}
            aria-label="Deletion confirmation phrase"
          />
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            disabled={!confirmPhraseOk(phrase) || del.isPending}
            onClick={onDelete}
          >
            {del.isPending ? "Deleting…" : "Delete my account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
