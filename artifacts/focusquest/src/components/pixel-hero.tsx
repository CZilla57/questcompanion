import { useEffect, useMemo, useRef } from "react";
import { resolveLayers } from "@/lib/hero/resolve-layers";
import { catalogById } from "@/lib/hero/catalog";
import type { HeroLook, ResolvedLayer } from "@/lib/hero/types";

const FRAME = 64; // native LPC frame size

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Draw an image tinted toward `tint` while preserving its alpha + shading (gear rarity). */
function drawTinted(ctx: CanvasRenderingContext2D, img: HTMLImageElement, tint: string) {
  const off = document.createElement("canvas");
  off.width = FRAME;
  off.height = FRAME;
  const octx = off.getContext("2d")!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(img, 0, 0, FRAME, FRAME);
  octx.globalCompositeOperation = "source-atop";
  octx.globalAlpha = 0.55;
  octx.fillStyle = tint;
  octx.fillRect(0, 0, FRAME, FRAME);
  octx.globalAlpha = 1;
  octx.globalCompositeOperation = "source-over";
  ctx.drawImage(off, 0, 0, FRAME, FRAME);
}

export function PixelHero({
  look,
  size = 160,
  className,
}: {
  look: HeroLook;
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Serialize the look so we only recompute/redraw when values actually change,
  // not on every parent re-render (the parent builds a fresh look object each time).
  const lookKey = JSON.stringify(look);
  const layers: ResolvedLayer[] = useMemo(
    () => resolveLayers(look, catalogById),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookKey],
  );

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    (async () => {
      const imgs = await Promise.all(layers.map((l) => loadImage(l.file)));
      if (cancelled) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, FRAME, FRAME);
      layers.forEach((l, i) => {
        if (l.tint) drawTinted(ctx, imgs[i], l.tint);
        else ctx.drawImage(imgs[i], 0, 0, FRAME, FRAME);
      });
    })().catch(() => {
      /* a missing/failed layer image is non-fatal; the other layers still render */
    });

    return () => {
      cancelled = true;
    };
  }, [layers]);

  return (
    <canvas
      ref={canvasRef}
      width={FRAME}
      height={FRAME}
      className={className}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      role="img"
      aria-label={`${look.build} ${look.avatarClass} hero`}
    />
  );
}
