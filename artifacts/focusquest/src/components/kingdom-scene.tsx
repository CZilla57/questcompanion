import { useEffect, useRef } from "react";
import { resolveScene, SCENE_W, SCENE_H, type Liveliness } from "@/lib/kingdom-scene";
import { SPRITES, TERRAIN_URL } from "@/lib/kingdom-sprites";

// THE RENDERER SEAM. Everything above this component speaks only in SceneLayer[]
// (see lib/kingdom-scene.ts), so swapping canvas for PixiJS later means
// reimplementing this file alone. Do not let scene logic leak in here.

// Screen-reader phrasing only, kept local to this renderer seam. The visible UI
// never speaks in verdict words ("dormant") or raw ids/tiers, so the aria-label
// shouldn't either — this is a label lookup, not scene composition logic.
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
        // Don't let one transient failure poison the cache for the page's lifetime —
        // drop the entry so a later render can retry.
        imageCache.delete(url);
        reject(e);
      };
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

export function KingdomScene({
  kingdomId, tier, liveliness, width, className,
}: {
  kingdomId: string;
  tier: number;
  liveliness: Liveliness;
  /** Fixed CSS width in px. Omit to size via className (e.g. w-full) — an
   *  inline width would override any class, so none is set unless asked for.
   *  Either way the canvas keeps its intrinsic 320:192 ratio. */
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;

    (async () => {
      const layers = resolveScene(kingdomId, tier, liveliness);

      // Collect every distinct image URL this scene needs.
      const urls = new Set<string>();
      for (const layer of layers) {
        const sprite = SPRITES[layer.spriteId];
        if (!sprite) continue;
        if (sprite.kind === "terrain") urls.add(TERRAIN_URL);
        else if (sprite.kind === "image") urls.add(sprite.url);
      }

      // allSettled so one missing asset cannot blank the whole scene — the same
      // resilience rule PixelHero uses for hero layers.
      const list = [...urls];
      const results = await Promise.allSettled(list.map(loadImage));
      if (cancelled) return;

      const images = new Map<string, HTMLImageElement>();
      list.forEach((url, i) => {
        const r = results[i];
        if (r?.status === "fulfilled") images.set(url, r.value);
      });

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, SCENE_W, SCENE_H);

      for (const layer of layers) {
        const sprite = SPRITES[layer.spriteId];
        if (!sprite) continue;
        ctx.globalAlpha = layer.alpha ?? 1;

        if (sprite.kind === "glow") {
          const [r, g, b] = sprite.rgb;
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(layer.x, layer.y, sprite.w, sprite.h);
          continue;
        }

        const url = sprite.kind === "terrain" ? TERRAIN_URL : sprite.url;
        const img = images.get(url);
        if (!img) continue;

        if (sprite.kind === "terrain") {
          ctx.drawImage(img, sprite.sx, sprite.sy, sprite.w, sprite.h, layer.x, layer.y, sprite.w, sprite.h);
        } else {
          ctx.drawImage(img, layer.x, layer.y, sprite.w, sprite.h);
        }
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
      aria-label={describeKingdom(kingdomId, tier, liveliness)}
    />
  );
}
