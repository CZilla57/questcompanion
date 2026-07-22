import { useState } from "react";
import { Smartphone, Copy, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListShortcutTokens, useMintShortcutToken, useRevokeShortcutToken,
  getListShortcutTokensQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

/** Pocket Gate: mint/revoke the fqs_ tokens the two iPhone Shortcuts use.
 * Reveal-once by design — the server only stores a hash, so the token is
 * copyable exactly while this panel is open. Plain copy, no dark patterns. */
export function ShortcutTokensCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tokens = useListShortcutTokens();
  const mint = useMintShortcutToken();
  const revoke = useRevokeShortcutToken();
  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState<{ label: string | null; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);

  const refetchList = () =>
    queryClient.invalidateQueries({ queryKey: getListShortcutTokensQueryKey() });

  async function onMint() {
    try {
      const res = await mint.mutateAsync({ data: { label: label.trim() || "iPhone" } });
      setMinted({ label: res.label, token: res.token });
      setCopied(false);
      setLabel("");
      await refetchList();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast({ title: "Couldn't create the token", description: msg, variant: "destructive" });
    }
  }

  async function onCopy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      toast({ title: "Token copied — paste it into your Shortcut" });
    } catch {
      toast({ title: "Couldn't copy — long-press the token text instead", variant: "destructive" });
    }
  }

  async function onRevoke(id: number) {
    try {
      await revoke.mutateAsync({ id });
      setConfirmRevokeId(null);
      await refetchList();
      toast({ title: "Token revoked" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast({ title: "Couldn't revoke the token", description: msg, variant: "destructive" });
    }
  }

  const base = window.location.origin;

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Smartphone className="w-4 h-4" /> Home Screen Shortcuts
      </div>
      <p className="text-xs text-muted-foreground">
        Add and complete quests from your iPhone home screen — no login, no waiting for
        the app. A token can only capture and complete quests; revoke it here any time.
      </p>

      {minted ? (
        <div className="rounded-lg border border-primary/40 p-2 space-y-1.5">
          <p className="text-xs font-medium">
            “{minted.label ?? "iPhone"}” created — this is the only time it's shown:
          </p>
          <code className="block text-[11px] break-all bg-muted rounded p-1.5">{minted.token}</code>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onCopy(minted.token)}>
              {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
              {copied ? "Copied" : "Copy token"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMinted(null)}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (iPhone)"
            aria-label="Token label"
            className="h-8 text-sm"
          />
          <Button variant="outline" size="sm" onClick={onMint} disabled={mint.isPending}>
            {mint.isPending ? "Creating…" : "Create token"}
          </Button>
        </div>
      )}

      {(tokens.data ?? []).length > 0 && (
        <ul className="space-y-1">
          {(tokens.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between text-xs gap-2">
              <span className="truncate">
                {t.label ?? "Token"}
                <span className="text-muted-foreground">
                  {" · "}{new Date(t.createdAt).toLocaleDateString()}{" · "}{t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "never used"}
                </span>
              </span>
              {confirmRevokeId === t.id ? (
                <span className="flex gap-1 shrink-0">
                  <Button variant="destructive" size="sm" className="h-6 px-2 text-xs" onClick={() => onRevoke(t.id)} disabled={revoke.isPending}>
                    Revoke
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setConfirmRevokeId(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0 text-muted-foreground" onClick={() => setConfirmRevokeId(t.id)}>
                  Revoke…
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground select-none">
          Set-up guide (build the two Shortcuts, ~3 min)
        </summary>
        <div className="mt-1.5 space-y-2 text-muted-foreground">
          <p className="font-medium text-foreground">“New Quest” — in the Shortcuts app, add:</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>Ask for Input (Text) — prompt: “What's the quest?”</li>
            <li>
              Get Contents of URL — <code className="break-all">{base}/api/shortcuts/capture</code>,
              Method POST, Header <code>Authorization</code> = <code>Bearer &lt;your token&gt;</code>,
              Request Body JSON: <code>text</code> = Provided Input
            </li>
            <li>Get Dictionary Value — key <code>message</code></li>
            <li>Show Notification — the Dictionary Value</li>
          </ol>
          <p className="font-medium text-foreground">“Quest Done” — add:</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>
              Get Contents of URL — <code className="break-all">{base}/api/shortcuts/today</code>,
              Method GET, same Authorization header
            </li>
            <li>Get Dictionary Value — key <code>quests</code>, then Choose from List</li>
            <li>Get Dictionary Value — the Chosen Item's key in <code>quests</code> (this is the quest id)</li>
            <li>
              Get Contents of URL — <code className="break-all">{base}/api/tasks/</code>[id]<code>/complete</code>,
              Method POST, same header, Request Body JSON (empty)
            </li>
            <li>Get Dictionary Value — key <code>pointsAwarded</code></li>
            <li>Show Notification — “Quest complete! +[value] XP”</li>
          </ol>
          <p>
            Then long-press your home screen → add the <span className="text-foreground">Shortcuts widget</span> and
            pick both. They also work from the Lock Screen, Control Center, the Action Button, and
            “Hey Siri, New Quest”.
          </p>
        </div>
      </details>
    </div>
  );
}
