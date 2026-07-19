import { useEffect, useRef } from "react";
import { resolveScene, SCENE_W, SCENE_H, type Liveliness } from "@/lib/kingdom-scene";
import { SPRITES, TERRAIN_URL } from "@/lib/kingdom-sprites";

// THE RENDERER SEAM. Everything above this component speaks only in SceneLayer[]
// (see lib/kingdom-scene.ts), so swapping canvas for PixiJS later means
// reimplementing this file alone. Do not let scene logic leak in here.

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
  kingdomId, tier, liveliness, width = SCENE_W, className,
}: {
  kingdomId: string;
  tier: number;
  liveliness: Liveliness;
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
      style={{ width, height: (width * SCENE_H) / SCENE_W, imageRendering: "pixelated" }}
      role="img"
      aria-label={`${kingdomId} kingdom, tier ${tier}, ${liveliness}`}
    />
  );
}
