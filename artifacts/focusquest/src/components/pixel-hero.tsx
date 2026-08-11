import { useEffect, useMemo, useRef } from "react";
import { resolveLayers } from "@/lib/hero/resolve-layers";
import { catalogById } from "@/lib/hero/catalog";
import {
  buildStage, registerSlot, unregisterSlot, triggerFlourish, type HeroSlot,
} from "@/lib/hero/hero-renderer";
import type { HeroLook, ResolvedLayer } from "@/lib/hero/types";

const QUEST_COMPLETED_EVENT = "quest-completed";

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
   *  dopamine-overlay.tsx). Only pass this on a hero display the user is actually looking at right
   *  after completing something — e.g. the dashboard hero, not an ally's or a body-double room
   *  participant's, since the event carries no hero identity and fires for the *viewer's* own
   *  completions regardless of whose hero is on screen. */
  celebrateOn?: "questCompleted";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slotRef = useRef<HeroSlot | null>(null);

  const lookKey = JSON.stringify(look);
  const layers: ResolvedLayer[] = useMemo(
    () => resolveLayers(look, catalogById),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookKey],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;
    let slot: HeroSlot | null = null;

    (async () => {
      const stage = await buildStage(layers);
      if (cancelled) {
        // Unmounted before we registered — destroy the freshly built stage + its sprites so nothing leaks.
        stage.destroy({ children: true, texture: true, textureSource: true });
        return;
      }
      slot = await registerSlot(stage, ctx, size);
      if (cancelled) {
        unregisterSlot(slot);
        slot = null;
        return;
      }
      slotRef.current = slot;
    })().catch((err) => {
      // Last-resort guard: image load / renderer init failures must not become unhandled rejections.
      console.error("PixelHero: renderer setup failed", err);
    });

    return () => {
      cancelled = true;
      if (slot) unregisterSlot(slot);
      slot = null;
      slotRef.current = null;
    };
  }, [layers, size]);

  useEffect(() => {
    if (!celebrateOn) return;
    const handler = () => {
      if (slotRef.current) triggerFlourish(slotRef.current);
    };
    window.addEventListener(QUEST_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(QUEST_COMPLETED_EVENT, handler);
  }, [celebrateOn]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      role="img"
      aria-label={`${look.build} ${look.avatarClass} hero`}
    />
  );
}
