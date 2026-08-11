import { useEffect, useMemo, useRef } from "react";
import {
  Application, AnimatedSprite, Container, Texture, Rectangle,
} from "pixi.js";
import { resolveLayers } from "@/lib/hero/resolve-layers";
import { catalogById } from "@/lib/hero/catalog";
import { FRAME_SIZE, FRAME_COUNT, idleFrameIndex } from "@/lib/hero/sprite-animation";
import type { HeroLook, ResolvedLayer } from "@/lib/hero/types";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Tint a whole frame-strip image toward `tint` while preserving its alpha + shading (gear
 *  rarity) — same source-atop technique the old single-frame drawTinted used, just applied to
 *  the full strip at once (each of its FRAME_COUNT frames gets tinted identically in one pass,
 *  since it's one continuous image). */
function tintStrip(img: HTMLImageElement, tint: string): HTMLCanvasElement {
  const off = document.createElement("canvas");
  off.width = img.width;
  off.height = img.height;
  const ctx = off.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return off;
}

/** Slice a loaded FRAME_COUNT-wide strip texture into FRAME_SIZE-square per-frame textures. */
function sliceFrames(strip: Texture): Texture[] {
  const frames: Texture[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    frames.push(new Texture({
      source: strip.source,
      frame: new Rectangle(i * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE),
    }));
  }
  return frames;
}

async function buildLayerSprite(layer: ResolvedLayer): Promise<AnimatedSprite | null> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(layer.file);
  } catch {
    return null; // a missing/failed layer is skipped; the rest still render
  }
  const source = layer.tint ? tintStrip(img, layer.tint) : img;
  const strip = Texture.from(source);
  return new AnimatedSprite({ textures: sliceFrames(strip), autoPlay: false, loop: true });
}

export function PixelHero({
  look,
  size = 160,
  className,
  celebrateOn: _celebrateOn,
}: {
  look: HeroLook;
  size?: number;
  className?: string;
  /** Wired up in a follow-up change; accepted here so the prop lands once. */
  celebrateOn?: "questCompleted";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const stageRef = useRef<Container | null>(null);

  const lookKey = JSON.stringify(look);
  const layers: ResolvedLayer[] = useMemo(
    () => resolveLayers(look, catalogById),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookKey],
  );

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    let cancelled = false;
    let initialized = false;
    const app = new Application();
    let tickHandler: (() => void) | null = null;

    (async () => {
      await app.init({
        width: FRAME_SIZE, height: FRAME_SIZE, backgroundAlpha: 0, antialias: false,
      });
      if (cancelled) {
        app.destroy(true, { children: true, texture: true, textureSource: true });
        return;
      }
      initialized = true;
      appRef.current = app;
      host.appendChild(app.canvas);

      // Pivot + position at the visual center so a future scale (the completion flourish) pops
      // from the center rather than the top-left corner. At scale=1 (idle) this is a no-op:
      // absolute position = (position - pivot) + local = local, identical to no pivot at all.
      const stage = new Container();
      stage.pivot.set(FRAME_SIZE / 2, FRAME_SIZE / 2);
      stage.position.set(FRAME_SIZE / 2, FRAME_SIZE / 2);
      app.stage.addChild(stage);
      stageRef.current = stage;

      const sprites = await Promise.all(layers.map(buildLayerSprite));
      if (cancelled) return; // torn down by the cleanup below once `initialized` is observed
      for (const s of sprites) if (s) stage.addChild(s);

      const start = performance.now();
      tickHandler = () => {
        const idx = idleFrameIndex(performance.now() - start);
        for (const s of sprites) s?.gotoAndStop(idx);
      };
      app.ticker.add(tickHandler);
    })();

    return () => {
      cancelled = true;
      if (!initialized) return; // init() hasn't resolved yet; the async block above tears itself down
      if (tickHandler) app.ticker.remove(tickHandler);
      appRef.current = null;
      stageRef.current = null;
      app.destroy(true, { children: true, texture: true, textureSource: true });
    };
  }, [layers]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      role="img"
      aria-label={`${look.build} ${look.avatarClass} hero`}
    />
  );
}
