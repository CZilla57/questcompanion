import { describe, it, expect } from "vitest";
import path from "node:path";
import sharp from "sharp";
import {
  resolveScene,
  resolveSceneImageUrl,
  KINGDOM_SCENES,
  SCENE_KINGDOM_IDS,
  SCENE_W,
  SCENE_H,
  MAX_KINGDOM_TIER,
  sceneSize,
  maxTierFor,
  CAPITAL_SCENE_W,
  CAPITAL_SCENE_H,
} from "./kingdom-scene";
import { SPRITES, LANTERN_ID, spriteSize, TILE } from "./kingdom-sprites";

const LIVELINESS = ["dormant", "stirring", "steady", "bustling"] as const;
const builds = (ls: { spriteId: string }[]) => ls.filter((l) => l.spriteId.startsWith("build."));
const lanterns = (ls: { spriteId: string }[]) => ls.filter((l) => l.spriteId === LANTERN_ID);

describe("resolveScene", () => {
  it("defines a scene for all six kingdoms", () => {
    expect(Object.keys(KINGDOM_SCENES).sort()).toEqual(
      ["athenaeum", "capital", "crossroads", "forge", "hearth", "wellspring"],
    );
  });

  it("resolves static tier scene images at each kingdom's own size", async () => {
    for (const id of SCENE_KINGDOM_IDS) {
      const { w, h } = sceneSize(id);
      for (let tier = 0; tier <= maxTierFor(id); tier++) {
        const url = resolveSceneImageUrl(id, tier);
        expect(url).toBe(`/kingdoms/scenes/${id}/tier-${tier}.png`);

        const file = path.resolve(__dirname, "../../public", url!.slice(1));
        const meta = await sharp(file).metadata();
        expect(`${meta.width}x${meta.height}`, `${id} tier ${tier}`).toBe(`${w}x${h}`);
      }
    }
  });

  it("gives the capital a wider band and a deeper ladder than the kingdoms", () => {
    expect(sceneSize("capital")).toEqual({ w: CAPITAL_SCENE_W, h: CAPITAL_SCENE_H });
    expect(sceneSize("hearth")).toEqual({ w: SCENE_W, h: SCENE_H });
    expect(maxTierFor("capital")).toBe(11);
    expect(maxTierFor("hearth")).toBe(5);
  });

  it("keeps every scene dimension a whole multiple of TILE", () => {
    for (const id of SCENE_KINGDOM_IDS) {
      const { w, h } = sceneSize(id);
      expect(w % TILE, `${id} width`).toBe(0);
      expect(h % TILE, `${id} height`).toBe(0);
    }
  });

  it("clamps static scene image tiers per kingdom", () => {
    expect(resolveSceneImageUrl("hearth", -10)).toBe("/kingdoms/scenes/hearth/tier-0.png");
    expect(resolveSceneImageUrl("hearth", 99)).toBe("/kingdoms/scenes/hearth/tier-5.png");
    expect(resolveSceneImageUrl("capital", 99)).toBe("/kingdoms/scenes/capital/tier-11.png");
    expect(resolveSceneImageUrl("capital", -1)).toBe("/kingdoms/scenes/capital/tier-0.png");
    expect(resolveSceneImageUrl("atlantis", 3)).toBeNull();
  });

  it("renders ground and props but no buildings at tier 0", () => {
    const layers = resolveScene("forge", 0, "steady");
    expect(layers.length).toBeGreaterThan(0);
    expect(builds(layers)).toHaveLength(0);
  });

  it("adds buildings as the tier climbs, never removing them", () => {
    let previous = 0;
    for (let tier = 0; tier <= 5; tier++) {
      const count = builds(resolveScene("hearth", tier, "steady")).length;
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it("keeps every earned building when dormant - quiet, never ruined", () => {
    const busy = builds(resolveScene("hearth", 4, "bustling")).map((l) => l.spriteId).sort();
    const quiet = builds(resolveScene("hearth", 4, "dormant")).map((l) => l.spriteId).sort();
    expect(quiet).toEqual(busy);
  });

  it("dims rather than damages when dormant", () => {
    const quiet = resolveScene("hearth", 4, "dormant");
    expect(quiet.some((l) => (l.alpha ?? 1) < 1)).toBe(true);
    expect(quiet.every((l) => !/ruin|rubble|broken|burn/.test(l.spriteId))).toBe(true);
  });

  it("keeps one light burning even when dormant", () => {
    // A fully dark village reads as abandoned; one lit lamp reads as a place
    // waiting for you. This is the asleep-vs-dead line.
    const lit = lanterns(resolveScene("hearth", 4, "dormant"));
    expect(lit).toHaveLength(1);
    expect(lit[0]!.alpha).toBe(1);
  });

  it("lights more windows as liveliness rises", () => {
    const count = (l: (typeof LIVELINESS)[number]) => lanterns(resolveScene("hearth", 5, l)).length;
    expect(count("dormant")).toBeLessThan(count("steady"));
    expect(count("steady")).toBeLessThan(count("bustling"));
  });

  it("shows no lanterns at tier 0 - nothing built to light", () => {
    expect(lanterns(resolveScene("hearth", 0, "bustling"))).toHaveLength(0);
  });

  it("resolves every sprite it references", () => {
    for (const id of Object.keys(KINGDOM_SCENES)) {
      for (let tier = 0; tier <= 5; tier++) {
        for (const liveliness of LIVELINESS) {
          for (const layer of resolveScene(id, tier, liveliness)) {
            expect(SPRITES[layer.spriteId], `missing sprite ${layer.spriteId}`).toBeDefined();
          }
        }
      }
    }
  });

  it("is deterministic", () => {
    expect(resolveScene("crossroads", 3, "steady")).toEqual(resolveScene("crossroads", 3, "steady"));
  });

  it("returns nothing for an unknown kingdom", () => {
    expect(resolveScene("atlantis", 3, "steady")).toEqual([]);
  });

  it("keeps every layer fully inside the scene bounds", () => {
    // Buildings anchor by bottom-centre and sprite heights differ, so a slot
    // placed too high clips the roof off the top of the canvas.
    for (const id of Object.keys(KINGDOM_SCENES)) {
      for (const liveliness of LIVELINESS) {
        for (const layer of resolveScene(id, 5, liveliness)) {
          const size = spriteSize(layer.spriteId)!;
          expect(layer.x, `${id}/${layer.spriteId} left`).toBeGreaterThanOrEqual(0);
          expect(layer.y, `${id}/${layer.spriteId} top`).toBeGreaterThanOrEqual(0);
          expect(layer.x + size.w, `${id}/${layer.spriteId} right`).toBeLessThanOrEqual(SCENE_W);
          expect(layer.y + size.h, `${id}/${layer.spriteId} bottom`).toBeLessThanOrEqual(SCENE_H);
        }
      }
    }
  });

  it("paints nearer buildings over further ones", () => {
    // Depth is the BOTTOM edge, not the top — a tall building further forward
    // must not sort behind a short one further back.
    const builds = resolveScene("hearth", 5, "steady").filter((l) => l.spriteId.startsWith("build."));
    const grounds = builds.map((l) => l.y + spriteSize(l.spriteId)!.h);
    expect(grounds).toEqual([...grounds].sort((a, b) => a - b));
  });
});
