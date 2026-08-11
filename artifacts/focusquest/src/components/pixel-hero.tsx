import { useEffect, useMemo, useRef } from "react";
import {
  Application, AnimatedSprite, Container, Graphics, Texture, Rectangle,
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

const QUEST_COMPLETED_EVENT = "quest-completed";

type ActiveFlourish = { tick: () => void; burst: Container };

/** A brief scale-pop + sparkle burst layered over the hero on task completion. Pure Pixi
 *  primitives, no new sprite frames — works identically for every hero regardless of which
 *  gear/hair/outfit item's source art has animation coverage (some third-party LPC add-on packs
 *  only ship a single static frame, not a full row — see the design doc). Self-removes when
 *  finished; `activeRef` lets a re-trigger mid-flourish cancel the old one instead of stacking
 *  two competing scale tweens on the same stage. */
function playCompletionFlourish(
  app: Application,
  stage: Container,
  activeRef: { current: ActiveFlourish | null },
) {
  const prev = activeRef.current;
  if (prev) {
    app.ticker.remove(prev.tick);
    prev.burst.destroy({ children: true });
    stage.scale.set(1);
  }

  const burst = new Container();
  stage.addChild(burst);

  const sparkleColors = [0xffd76a, 0xffe9a8, 0xffffff];
  const sparkles = Array.from({ length: 6 }, (_, i) => {
    const g = new Graphics().circle(0, 0, 2 + (i % 2)).fill(sparkleColors[i % sparkleColors.length]);
    burst.addChild(g);
    return { g, angle: (i / 6) * Math.PI * 2 };
  });

  const DURATION_MS = 550;
  const start = performance.now();
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / DURATION_MS);
    const eased = 1 - (1 - t) * (1 - t); // ease-out
    stage.scale.set(1 + Math.sin(eased * Math.PI) * 0.18);
    for (const { g, angle } of sparkles) {
      const dist = eased * 22;
      g.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist);
      g.alpha = 1 - eased;
    }
    if (t >= 1) {
      app.ticker.remove(tick);
      stage.scale.set(1);
      burst.destroy({ children: true });
      if (activeRef.current?.tick === tick) activeRef.current = null;
    }
  };
  app.ticker.add(tick);
  activeRef.current = { tick, burst };
}

export function PixelHero({
  look,
  size = 160,
  className,
  celebrateOn,
}: {
  look: HeroLook;
  size?: number;
  className?: string;
  /** Opt in to a completion flourish on the existing global "quest-completed" event (see
   *  dopamine-overlay.tsx). Only pass this on a hero display the user is actually looking at
   *  right after completing something — e.g. the dashboard hero, not an ally's or a body-double
   *  room participant's, since the event carries no hero identity and fires for the *viewer's*
   *  own completions regardless of whose hero is on screen. */
  celebrateOn?: "questCompleted";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const stageRef = useRef<Container | null>(null);
  const activeFlourishRef = useRef<ActiveFlourish | null>(null);

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
      if (activeFlourishRef.current) {
        app.ticker.remove(activeFlourishRef.current.tick);
        activeFlourishRef.current = null;
      }
      if (tickHandler) app.ticker.remove(tickHandler);
      appRef.current = null;
      stageRef.current = null;
      app.destroy(true, { children: true, texture: true, textureSource: true });
    };
  }, [layers]);

  useEffect(() => {
    if (!celebrateOn) return;
    const handler = () => {
      const app = appRef.current;
      const stage = stageRef.current;
      if (app && stage) playCompletionFlourish(app, stage, activeFlourishRef);
    };
    window.addEventListener(QUEST_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(QUEST_COMPLETED_EVENT, handler);
  }, [celebrateOn]);

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
