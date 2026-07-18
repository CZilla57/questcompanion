import { useGetHeroStatus } from "@workspace/api-client-react";
import { stageSegments, stageLabel, type HungerStage } from "@/lib/hero-vitality";

/**
 * Vitality bar + mood + ambient "hero life" status line, fed by
 * GET /users/me/hero-status. `compact` drops the mood line for tight layouts
 * (dashboard hero summary).
 */
export function HeroVitality({ compact = false }: { compact?: boolean }) {
  const { data } = useGetHeroStatus();
  if (!data) return null;

  const stage = data.stage as HungerStage;
  const filled = stageSegments(stage);
  const danger = stage === "starving" || stage === "fainted";

  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-center gap-2">
        <div className="flex gap-0.5" role="meter" aria-valuemin={0} aria-valuemax={5} aria-valuenow={filled} aria-label={`Vitality: ${stageLabel(stage)}`}>
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className={`h-2 w-4 rounded-sm ${
                i < filled ? (danger ? "bg-red-500" : "bg-amber-400") : "bg-muted/40"
              }`}
            />
          ))}
        </div>
        <span className={`text-xs font-medium ${danger ? "text-red-400" : "text-muted-foreground"}`}>
          {stageLabel(stage)}
        </span>
      </div>
      {!compact && <div className="text-xs text-muted-foreground italic">{data.mood}</div>}
      {data.companion.line && data.companion.beat !== "ambient" ? (
        <div className="text-xs font-medium text-primary">{data.companion.line}</div>
      ) : null}
      <div className="text-xs text-muted-foreground">
        Currently: <span className="italic">{data.activity.text}</span>
      </div>
      {!compact && (
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {data.companion.bondTierName}
          {data.companion.beat === "ambient" && data.companion.line ? ` · ${data.companion.line}` : ""}
        </div>
      )}
    </div>
  );
}
