import { useGetMyPatterns, getGetMyPatternsQueryKey } from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { rhythmsState, rhythmsLines } from "@/lib/rhythms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Waves, Sparkles } from "lucide-react";

/** Confidence-gated strengths card. Positive framings only — blockers feed
 * the reflection LLM, never this surface (anti-shame). */
export function RhythmsCard() {
  const { data, isLoading } = useGetMyPatterns({ tz: browserTimeZone() }, { query: { queryKey: getGetMyPatternsQueryKey({ tz: browserTimeZone() }), staleTime: 5 * 60_000 } });
  if (isLoading || !data) return null;

  const state = rhythmsState(data);
  const lines = rhythmsLines(data);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Waves className="w-4 h-4 text-primary" />
          Your rhythms
          {state === "early" && (
            <span className="text-xs font-normal text-muted-foreground">early read</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state === "empty" || lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Still learning your rhythms — a few more days of quests will unlock this.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {(state === "early" ? lines.slice(0, 1) : lines).map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm">
                <Sparkles className="w-3.5 h-3.5 mt-0.5 text-primary flex-shrink-0" />
                {line}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
