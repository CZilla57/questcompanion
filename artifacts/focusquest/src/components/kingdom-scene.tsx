import { useEffect, useRef } from "react";
import { resolveSceneImageUrl, sceneSize, type Liveliness } from "@/lib/kingdom-scene";

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
function describeKingdom(kingdomId: string, tier: number, liveliness: Liveliness | null): string {
  const name = kingdomId.charAt(0).toUpperCase() + kingdomId.slice(1);
  // Falls back to the HIGHEST defined phrase, not TIER_PHRASE[0]. This table
  // only covers tiers 0-5; the capital's ladder runs to 11 and reaches here
  // whenever a caller omits the optional `label` override. Under-reporting
  // (falling back to "untouched land") would erase real work a screen-reader
  // user actually did; over-reporting is merely imprecise. When forced to be
  // wrong, be wrong in the direction that doesn't insult the user's progress.
  const tierPhrase = TIER_PHRASE[tier] ?? TIER_PHRASE[5];
  if (liveliness === null) return `${name}, ${tierPhrase}`;
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

function paintLivelinessOverlay(
  ctx: CanvasRenderingContext2D,
  liveliness: Liveliness | null,
  tier: number,
  w: number,
  h: number,
) {
  if (liveliness === null) return;
  switch (liveliness) {
    case "dormant":
      ctx.fillStyle = "rgba(12, 20, 42, 0.36)";
      ctx.fillRect(0, 0, w, h);
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
      ctx.fillRect(0, 0, w, h);
      break;
    case "steady":
      break;
    case "bustling":
      ctx.fillStyle = "rgba(255, 218, 128, 0.12)";
      ctx.fillRect(0, 0, w, h);
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
  /** Null means "no reading" — full art, no overlay. The capital uses this:
   *  liveliness is a share of recent activity, and a cumulative total has no
   *  share. Previously the capital passed a fake "steady" to avoid dimming. */
  liveliness: Liveliness | null;
  /** Fixed CSS width in px. Omit to size via className (e.g. w-full); an
   *  inline width would override any class, so none is set unless asked for.
   *  Either way the canvas maintains its kingdom's intrinsic aspect ratio. */
  width?: number;
  className?: string;
  /** Overrides the generated aria-label. Used by the capital to ensure
   *  screen-reader users never hear a liveliness verdict that sighted users
   *  are not shown. */
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w: sceneW, h: sceneH } = sceneSize(kingdomId);

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
      ctx.clearRect(0, 0, sceneW, sceneH);

      const loaded = result[0];
      if (loaded?.status === "fulfilled") {
        ctx.drawImage(loaded.value, 0, 0, sceneW, sceneH);
        paintLivelinessOverlay(ctx, liveliness, tier, sceneW, sceneH);
      }
      ctx.globalAlpha = 1;
    })();

    return () => { cancelled = true; };
  }, [kingdomId, tier, liveliness, sceneW, sceneH]);

  return (
    <canvas
      ref={ref}
      width={sceneW}
      height={sceneH}
      className={className}
      style={{
        ...(width !== undefined ? { width, height: (width * sceneH) / sceneW } : undefined),
        imageRendering: "pixelated",
      }}
      role="img"
      aria-label={label ?? describeKingdom(kingdomId, tier, liveliness)}
    />
  );
}
