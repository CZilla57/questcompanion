import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import sharp from "sharp";
import { TERRAIN_SPRITES } from "./kingdom-sprites";

// Prop rects were hand-picked off the vendored sheet, and the sheet is a packed
// component kit — a rect that looks right can still slice through a sprite, and
// the cut edge renders in-scene as a hard straight line of chopped art. This
// suite checks the actual pixels for that signature: opaque art straddling a
// rect border in a wide front.
//
// Straddle width, not connectivity: some whole sprites sit packed flush against
// a neighbour (prop.boulder kisses the water-tile block for a few rows), so
// "any adjacent opaque pixel outside" would false-positive. A real chop at this
// art scale straddles the border for tens of pixels; flush packing for a few.

const SHEET = path.resolve(__dirname, "../../public/kingdoms/terrain.png");
const ALPHA_MIN = 17; // below this is packing noise, not visible art
const MAX_STRADDLE = 8; // px of inside/outside opaque contact tolerated per edge

let width = 0;
let height = 0;
let alpha: Uint8Array; // one byte per pixel

beforeAll(async () => {
  const { data, info } = await sharp(SHEET).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  width = info.width;
  height = info.height;
  alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
});

const opaque = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < width && y < height && alpha[y * width + x]! >= ALPHA_MIN;

/** Count pixels where art is opaque on BOTH sides of each rect border line. */
function straddles(sx: number, sy: number, w: number, h: number): Record<string, number> {
  let top = 0, bottom = 0, left = 0, right = 0;
  for (let x = sx; x < sx + w; x++) {
    if (opaque(x, sy) && opaque(x, sy - 1)) top++;
    if (opaque(x, sy + h - 1) && opaque(x, sy + h)) bottom++;
  }
  for (let y = sy; y < sy + h; y++) {
    if (opaque(sx, y) && opaque(sx - 1, y)) left++;
    if (opaque(sx + w - 1, y) && opaque(sx + w, y)) right++;
  }
  return { top, bottom, left, right };
}

describe("terrain sheet prop rects", () => {
  // Ground tiles are deliberate crops of continuous terrain, so only the
  // free-standing props are held to whole-sprite framing.
  const props = Object.entries(TERRAIN_SPRITES).filter(([id]) => id.startsWith("prop."));

  it("has props to check", () => {
    expect(props.length).toBeGreaterThan(0);
  });

  it.each(props)("%s does not cut through sprite art", (id, rect) => {
    const s = straddles(rect.sx, rect.sy, rect.w, rect.h);
    const worst = Math.max(s.top, s.bottom, s.left, s.right);
    expect(
      worst,
      `${id} rect (${rect.sx},${rect.sy} ${rect.w}x${rect.h}) has art crossing its border: ` +
        `top:${s.top} bottom:${s.bottom} left:${s.left} right:${s.right} px`,
    ).toBeLessThanOrEqual(MAX_STRADDLE);
  });
});
