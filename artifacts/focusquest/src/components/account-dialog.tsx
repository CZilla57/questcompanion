import { useState } from "react";
import { Settings, Download, ShieldAlert } from "lucide-react";
import { useDeleteMe } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { confirmPhraseOk, DELETE_PHRASE, exportFileName, exportStrategy } from "@/lib/account";

/** Account settings + Danger zone (Act VII q7). Plain copy, no dark patterns:
 * export is one tap, deletion is honest about being unrecoverable and takes a
 * typed phrase — friction, not guilt. */
export function AccountDialog() {
  const { toast } = useToast();
  const { isStandalone } = usePwaInstall();
  const del = useDeleteMe();
  const [phrase, setPhrase] = useState("");
  const [exporting, setExporting] = useState(false);

  // Never navigate to the export URL: in the chrome-less standalone webview
  // that lands on the raw JSON with no way back — restart-the-app territory
  // (found in the on-device walkthrough). Fetch and hand the file over instead.
  async function onExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/me/export", { credentials: "include" });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const file = new File([blob], exportFileName(new Date()), { type: "application/json" });

      const canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
      if (exportStrategy({ standalone: isStandalone, canShareFiles }) === "share") {
        try {
          await navigator.share({ files: [file], title: "FocusQuest export" });
        } catch (e) {
          // Dismissing the share sheet is a choice, not an error.
          if (!(e instanceof DOMException && e.name === "AbortError")) throw e;
        }
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast({ title: "Couldn't export your data", description: msg, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

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
      {/* No auto-focus: letting Radix focus the first control lands on the
          confirm input on some paths and pops the mobile keyboard over a
          dialog nobody has read yet. Focus follows the user's own tap. */}
      <DialogContent className="max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
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
          <Button variant="outline" size="sm" onClick={onExport} disabled={exporting}>
            {exporting ? "Preparing…" : "Download export"}
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
