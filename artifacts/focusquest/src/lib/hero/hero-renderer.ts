import {
  AnimatedSprite, Application, Container, Graphics, Rectangle, RenderTexture, Texture,
} from "pixi.js";
import { FRAME_SIZE, FRAME_COUNT, idleFrameIndex } from "./sprite-animation";
import type { ResolvedLayer } from "./types";

// ONE shared Pixi Application drives every hero sprite on the page — one WebGL context total, no matter
// how many <PixelHero> instances mount (a body-double room renders one per member). Each PixelHero
// registers a "slot": an offscreen stage Container (its layer sprites + optional flourish overlay), a
// visible 2D <canvas>, and a fixed FRAME_SIZE RenderTexture. One ticker advances the shared idle clock,
// renders each slot's stage into its RenderTexture, and blits the result into the slot's canvas. The
// shared app is created lazily and never destroyed — it is intentionally a process-lifetime singleton.

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Tint a whole frame-strip toward `tint` while preserving its alpha + shading (gear rarity). */
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

/** Slice a FRAME_COUNT-wide strip texture into FRAME_SIZE-square per-frame textures. */
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

/** Build an offscreen stage for one hero: its layer sprites, pivoted+positioned at the visual center
 *  so the flourish scale pops from the center rather than the top-left corner. */
export async function buildStage(layers: ResolvedLayer[]): Promise<Container> {
  const stage = new Container();
  stage.pivot.set(FRAME_SIZE / 2, FRAME_SIZE / 2);
  stage.position.set(FRAME_SIZE / 2, FRAME_SIZE / 2);
  const sprites = await Promise.all(layers.map(buildLayerSprite));
  for (const s of sprites) if (s) stage.addChild(s);
  return stage;
}

type Sparkle = { g: Graphics; angle: number };
type Flourish = { start: number; burst: Container; sparkles: Sparkle[] };

export type HeroSlot = {
  stage: Container;
  ctx: CanvasRenderingContext2D;
  size: number;
  rt: RenderTexture;
  flourish: Flourish | null;
  lastIdx: number;
};

let appPromise: Promise<Application> | null = null;
const slots = new Set<HeroSlot>();
let clockStart = 0;

function getApp(): Promise<Application> {
  if (!appPromise) {
    const app = new Application();
    appPromise = app
      .init({ width: FRAME_SIZE, height: FRAME_SIZE, backgroundAlpha: 0, antialias: false })
      .then(() => {
        clockStart = performance.now();
        app.ticker.add(() => renderAll(app));
        return app;
      });
  }
  return appPromise;
}

const FLOURISH_MS = 550;
const SPARKLE_COLORS = [0xffd76a, 0xffe9a8, 0xffffff];

/** Advance one slot's flourish by the current time. Returns true if a flourish was active this frame
 *  (including the terminal frame that resets scale to 1 — so that reset gets rendered once). */
function advanceFlourish(slot: HeroSlot, now: number): boolean {
  const f = slot.flourish;
  if (!f) return false;
  const t = Math.min(1, (now - f.start) / FLOURISH_MS);
  const eased = 1 - (1 - t) * (1 - t); // ease-out
  slot.stage.scale.set(1 + Math.sin(eased * Math.PI) * 0.18);
  for (const { g, angle } of f.sparkles) {
    const dist = eased * 22;
    g.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist);
    g.alpha = 1 - eased;
  }
  if (t >= 1) {
    slot.stage.scale.set(1);
    f.burst.destroy({ children: true });
    slot.flourish = null;
  }
  return true;
}

function renderAll(app: Application) {
  const now = performance.now();
  const idx = idleFrameIndex(now - clockStart);
  for (const slot of slots) {
    const flourishing = advanceFlourish(slot, now);
    if (idx === slot.lastIdx && !flourishing) continue; // idle heroes re-blit only on a frame change
    slot.lastIdx = idx;
    for (const child of slot.stage.children) {
      const s = child as unknown as Partial<AnimatedSprite>;
      if (typeof s.gotoAndStop === "function") s.gotoAndStop(idx);
    }
    app.renderer.render({ container: slot.stage, target: slot.rt });
    const src = app.renderer.extract.canvas(slot.rt) as unknown as CanvasImageSource;
    const { ctx, size } = slot;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, size, size); // FRAME_SIZE-square source scaled (nearest-neighbor) to size
  }
}

/** Register a hero for shared rendering. Resolves once the shared app is ready. */
export async function registerSlot(
  stage: Container, ctx: CanvasRenderingContext2D, size: number,
): Promise<HeroSlot> {
  await getApp();
  const rt = RenderTexture.create({ width: FRAME_SIZE, height: FRAME_SIZE, antialias: false });
  const slot: HeroSlot = { stage, ctx, size, rt, flourish: null, lastIdx: -1 };
  slots.add(slot);
  return slot;
}

/** Remove a hero and free its GPU resources (NOT the shared app). */
export function unregisterSlot(slot: HeroSlot): void {
  slots.delete(slot);
  if (slot.flourish) {
    slot.flourish.burst.destroy({ children: true });
    slot.flourish = null;
  }
  slot.rt.destroy(true);
  slot.stage.destroy({ children: true, texture: true, textureSource: true });
}

/** Play a scale-pop + centered sparkle burst on one slot. A re-trigger mid-flourish cancels the old
 *  one (no stacked tweens). Pure Pixi primitives — no new sprite art. */
export function triggerFlourish(slot: HeroSlot): void {
  if (slot.flourish) {
    slot.flourish.burst.destroy({ children: true });
    slot.stage.scale.set(1);
    slot.flourish = null;
  }
  const burst = new Container();
  burst.position.set(FRAME_SIZE / 2, FRAME_SIZE / 2); // emanate from the hero's visual center
  slot.stage.addChild(burst);
  const sparkles: Sparkle[] = Array.from({ length: 6 }, (_, i) => {
    const g = new Graphics().circle(0, 0, 2 + (i % 2)).fill(SPARKLE_COLORS[i % SPARKLE_COLORS.length]);
    burst.addChild(g);
    return { g, angle: (i / 6) * Math.PI * 2 };
  });
  slot.flourish = { start: performance.now(), burst, sparkles };
  slot.lastIdx = -1; // force an immediate re-render on the next tick
}
