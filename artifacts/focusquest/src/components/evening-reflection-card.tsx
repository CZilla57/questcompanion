import { Link } from "wouter";
import { useGetTodayReflection, getGetTodayReflectionQueryKey } from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { eveningCardVisible, REFLECTION_CARD_START_HOUR } from "@/lib/reflection-window";
import { CHIP_PILL_CLASS } from "@/lib/chip";
import { Card, CardContent } from "@/components/ui/card";
import { Moon, ChevronRight } from "lucide-react";

/** Now-screen CTA, 17:00 → midnight local while tonight is unanswered.
 * Deliberately fetches WITHOUT draft — seeing the Now screen never spends an
 * LLM call; only opening /reflection drafts the question. */
export function EveningReflectionCard({ variant = "card" }: { variant?: "card" | "chip" } = {}) {
  const now = new Date();
  const inWindow = now.getHours() >= REFLECTION_CARD_START_HOUR;
  const tz = browserTimeZone();
  const { data } = useGetTodayReflection(
    { tz },
    { query: { enabled: inWindow, queryKey: getGetTodayReflectionQueryKey({ tz }) } },
  );

  const answered = data?.reflection?.answeredAt != null;
  if (!inWindow || data === undefined || !eveningCardVisible(now, answered)) return null;

  if (variant === "chip") {
    return (
      <Link href="/reflection" className={CHIP_PILL_CLASS}>
        <Moon className="w-3.5 h-3.5 text-primary" aria-hidden /> Evening reflection — 1 minute
      </Link>
    );
  }

  return (
    <Link href="/reflection">
      <Card className="cursor-pointer border-primary/30 hover:border-primary/60 transition-colors">
        <CardContent className="flex items-center gap-3 py-4">
          <Moon className="w-5 h-5 text-primary flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-sm">Evening reflection</p>
            <p className="text-xs text-muted-foreground">1 minute — what worked today?</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
