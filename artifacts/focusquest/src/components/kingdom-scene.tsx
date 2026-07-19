import { useEffect, useRef } from "react";
import { resolveSceneImageUrl, SCENE_W, SCENE_H, type Liveliness } from "@/lib/kingdom-scene";

// THE RENDERER SEAM. Everything above this component speaks only in kingdom id,
// tier, and liveliness. Swapping this static-image canvas for PixiJS later means
// reimplementing this file alone. Do not let scene logic leak in here.

// Screen-reader phrasing only, kept local to this renderer seam. The visible UI
// never speaks in verdict words ("dormant") or raw ids/tiers, so the aria-label
// shouldn't either; this is a label lookup, not scene composition logic.
const TIER_PHRASE: Record<number, string> = {
  0: "untouched land",
  1: "a small outpost",
  2: "a settlement",
  3: "a village",
  4: "a town",
  5: "a stronghold",
};

const LIVELINESS_PHRASE: Record<Liveliness, string> = {
  dormant: "quiet",
  stirring: "waking up",
  steady: "busy",
  bustling: "thriving",
};

/** Kingdom ids are already their capitalized display name lowercased
 *  (hearth/wellspring/forge/athenaeum/crossroads/capital), so a plain
 *  capitalize avoids a second copy of the name table in this seam. */
function describeKingdom(kingdomId: string, tier: number, liveliness: Liveliness): string {
  const name = kingdomId.charAt(0).toUpperCase() + kingdomId.slice(1);
  const tierPhrase = TIER_PHRASE[tier] ?? TIER_PHRASE[0];
  const livelinessPhrase = LIVELINESS_PHRASE[liveliness] ?? LIVELINESS_PHRASE.dormant;
  return `${name}, ${tierPhrase}, ${livelinessPhrase} right now`;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => {
        // Don't let one transient failure poison the cache for the page's lifetime.
        imageCache.delete(url);
        reject(e);
      };
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

function paintLivelinessOverlay(ctx: CanvasRenderingContext2D, liveliness: Liveliness, tier: number) {
  switch (liveliness) {
    case "dormant":
      ctx.fillStyle = "rgba(12, 20, 42, 0.36)";
      ctx.fillRect(0, 0, SCENE_W, SCENE_H);
      if (tier > 0) {
        const glow = ctx.createRadialGradient(238, 124, 1, 238, 124, 28);
        glow.addColorStop(0, "rgba(255, 218, 142, 0.8)");
        glow.addColorStop(1, "rgba(255, 218, 142, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(210, 96, 56, 56);
      }
      break;
    case "stirring":
      ctx.fillStyle = "rgba(255, 197, 118, 0.1)";
      ctx.fillRect(0, 0, SCENE_W, SCENE_H);
      break;
    case "steady":
      break;
    case "bustling":
      ctx.fillStyle = "rgba(255, 218, 128, 0.12)";
      ctx.fillRect(0, 0, SCENE_W, SCENE_H);
      if (tier > 0) {
        ctx.fillStyle = "rgba(255, 235, 170, 0.55)";
        for (const [x, y] of [[54, 136], [148, 122], [250, 138]]) {
          ctx.fillRect(x, y, 3, 3);
        }
      }
      break;
  }
}

export function KingdomScene({
  kingdomId, tier, liveliness, width, className, label,
}: {
  kingdomId: string;
  tier: number;
  liveliness: Liveliness;
  /** Fixed CSS width in px. Omit to size via className (e.g. w-full); an
   *  inline width would override any class, so none is set unless asked for.
   *  Either way the canvas keeps its intrinsic 320:192 ratio. */
  width?: number;
  className?: string;
  /** Overrides the generated aria-label. Required by the capital, which passes a
   *  neutral `liveliness` purely to get undimmed art — it has no liveliness
   *  reading to report, so the default label would announce "busy right now" to
   *  screen-reader users while sighted users are shown no verdict at all. */
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;

    (async () => {
      const url = resolveSceneImageUrl(kingdomId, tier);
      if (!url) return;

      const result = await Promise.allSettled([loadImage(url)]);
      if (cancelled) return;

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, SCENE_W, SCENE_H);

      const loaded = result[0];
      if (loaded?.status === "fulfilled") {
        ctx.drawImage(loaded.value, 0, 0, SCENE_W, SCENE_H);
        paintLivelinessOverlay(ctx, liveliness, tier);
      }
      ctx.globalAlpha = 1;
    })();

    return () => { cancelled = true; };
  }, [kingdomId, tier, liveliness]);

  return (
    <canvas
      ref={ref}
      width={SCENE_W}
      height={SCENE_H}
      className={className}
      style={{
        ...(width !== undefined ? { width, height: (width * SCENE_H) / SCENE_W } : undefined),
        imageRendering: "pixelated",
      }}
      role="img"
      aria-label={label ?? describeKingdom(kingdomId, tier, liveliness)}
    />
  );
}
