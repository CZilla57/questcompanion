import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyRecaps, getGetMyRecapsQueryKey, useUpdateRecapEmailSettings,
} from "@workspace/api-client-react";
import type { WeeklyRecapItem } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Mail, ScrollText } from "lucide-react";

/** ISO week key ("2026-W29") → that week's Monday as a UTC-anchored Date. */
function mondayOfIsoWeek(weekKey: string): Date {
  const [y, w] = weekKey.split("-W");
  const jan4 = new Date(Date.UTC(Number(y), 0, 4));
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const monday = new Date(mondayW1);
  monday.setUTCDate(mondayW1.getUTCDate() + (Number(w) - 1) * 7);
  return monday;
}

function weekLabel(weekKey: string): string {
  const mon = mondayOfIsoWeek(weekKey);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

function statChips(recap: WeeklyRecapItem): string[] {
  const chips: string[] = [];
  const s = recap.stats;
  if (s.questsCompleted > 0) chips.push(`${s.questsCompleted} quest${s.questsCompleted === 1 ? "" : "s"}`);
  if (s.focusMinutes > 0) chips.push(`${s.focusMinutes} focus min`);
  if (s.xpEarned > 0) chips.push(`${s.xpEarned} XP`);
  if (s.boss) chips.push(`${s.boss.damage} boss dmg${s.boss.defeated ? " 🐉" : ""}`);
  return chips;
}

export function WeeklyRecapsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetMyRecaps({ query: { queryKey: getGetMyRecapsQueryKey() } });
  const toggle = useUpdateRecapEmailSettings({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMyRecapsQueryKey() }),
    },
  });

  if (isLoading || !data) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="w-4 h-4 text-primary" />
            Weekly recaps
          </CardTitle>
          {data.emailKnown && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Mail className="w-3.5 h-3.5" />
              Email me weekly recaps
              <Switch
                checked={data.emailEnabled}
                disabled={toggle.isPending}
                onCheckedChange={(checked) => toggle.mutate({ data: { enabled: checked } })}
              />
            </label>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {data.recaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Your first recap arrives Monday morning — a look back at the week you built. 🌱
          </p>
        ) : (
          <ul className="space-y-4">
            {data.recaps.map((recap) => (
              <li key={recap.weekKey} className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <span className="text-sm font-semibold text-foreground">{weekLabel(recap.weekKey)}</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {statChips(recap).map((chip) => (
                      <span key={chip} className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{recap.narrative}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
