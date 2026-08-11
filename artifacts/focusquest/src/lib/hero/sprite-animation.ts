// Shared timing/geometry constants for the hero's animated LPC sprite strips. FRAME_COUNT is
// duplicated here (not imported from scripts/) rather than shared via a workspace package,
// matching this codebase's existing convention of small local geometry constants (see the
// standalone `FRAME = 64` in pixel-hero.tsx) — this is a single verified number, not a policy
// that needs one owner. See scripts/src/build-lpc-assets.ts's FRAMES constant and
// cropSouthStrip's build-time assertion for where that verification is enforced.
export const FRAME_SIZE = 64; // native LPC frame size, px
export const FRAME_COUNT = 9; // frames in the LPC south-facing walk row
export const IDLE_FPS = 8;

/**
 * Which frame of a looping FRAME_COUNT-frame strip should be showing right now, given how long
 * the animation has been running. Pure function so every layer sprite can be driven from the
 * same clock and stay in lockstep — see pixel-hero.tsx, which calls this once per tick and
 * applies the result to every layer's AnimatedSprite via gotoAndStop(), rather than letting each
 * sprite play independently (which could drift out of sync frame-to-frame).
 */
export function idleFrameIndex(
  elapsedMs: number,
  fps: number = IDLE_FPS,
  frameCount: number = FRAME_COUNT,
): number {
  const msPerFrame = 1000 / fps;
  return Math.floor(elapsedMs / msPerFrame) % frameCount;
}
