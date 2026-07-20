import { useQueryClient } from "@tanstack/react-query";
import {
  useGetNotificationPrefs, useUpdateNotificationPrefs,
  getGetNotificationPrefsQueryKey, type NotificationPrefs,
} from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { PREF_CATEGORIES, hourLabel } from "@/lib/notification-prefs";
import { useToast } from "@/hooks/use-toast";

export function NotificationPrefsPanel({ subscribed }: { subscribed: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: prefs, isLoading } = useGetNotificationPrefs();
  const update = useUpdateNotificationPrefs();

  const put = async (next: NotificationPrefs) => {
    const updated = await update.mutateAsync({ data: next });
    qc.setQueryData(getGetNotificationPrefsQueryKey(), updated);
  };

  const save = (next: NotificationPrefs) => {
    put(next).catch(() => {
      toast({ title: "Couldn't save preferences", description: "Nothing changed — try again in a moment.", variant: "destructive" });
    });
  };

  if (isLoading) {
    return <div className="p-3 text-xs text-muted-foreground">Loading preferences…</div>;
  }
  if (!prefs) {
    return <div className="p-3 text-xs text-muted-foreground">Couldn't load preferences — try reopening this menu.</div>;
  }

  return (
    <div className="w-64 space-y-3">
      <div className="space-y-2.5">
        {PREF_CATEGORIES.map(({ key, label, hint }) => (
          <div key={key} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{label}</div>
              <div className="text-[11px] text-muted-foreground leading-snug">{hint}</div>
            </div>
            <Switch
              aria-label={label}
              checked={prefs[key]}
              disabled={!subscribed || update.isPending}
              onCheckedChange={(checked) => save({ ...prefs, [key]: checked })}
            />
          </div>
        ))}
      </div>

      <div className="border-t border-border pt-3">
        <div className="text-sm font-medium text-foreground mb-1.5">Quiet hours</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <span>Quiet from</span>
            <select
              aria-label="Quiet from"
              className="rounded-md border border-input bg-background px-1.5 py-1 text-xs"
              value={prefs.quietHoursStart}
              disabled={!subscribed || update.isPending}
              onChange={(e) => save({ ...prefs, quietHoursStart: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span>until</span>
            <select
              aria-label="Quiet until"
              className="rounded-md border border-input bg-background px-1.5 py-1 text-xs"
              value={prefs.quietHoursEnd}
              disabled={!subscribed || update.isPending}
              onChange={(e) => save({ ...prefs, quietHoursEnd: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
          Self-care nudges may still arrive late — that's when they matter. Nothing ever sends 2–7 AM.
        </p>
      </div>
    </div>
  );
}
