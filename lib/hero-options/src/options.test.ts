import { describe, it, expect } from "vitest";
import {
  builds, skins, hairStyles, hairColors, faces, classes, colors,
  ids, includesId, type Option,
} from "./index";

const AXES: Record<string, readonly Option[]> = {
  builds, skins, hairStyles, hairColors, faces, classes, colors,
};

describe("hero-options registry", () => {
  it("has no duplicate ids within any axis", () => {
    for (const [name, axis] of Object.entries(AXES)) {
      const seen = ids(axis);
      expect(new Set(seen).size, `dup id in ${name}`).toBe(seen.length);
    }
  });

  it("preserves the current option values (regression lock)", () => {
    expect(ids(builds)).toEqual(["male", "female"]);
    expect(ids(skins)).toEqual([
      "light", "tan", "brown", "dark", "green", "blue", "olive", "bronze", "almond",
    ]);
    expect(ids(hairStyles)).toEqual([
      "bald", "short", "long", "ponytail", "afro", "bob", "curly", "spiked", "bangs", "pixie",
    ]);
    expect(ids(hairColors)).toEqual([
      "brown", "black", "blonde", "red", "white", "blue",
      "gray", "auburn", "green", "purple", "pink", "orange",
    ]);
    expect(ids(faces)).toEqual(["neutral", "stern", "smile"]);
    expect(ids(classes)).toEqual(["fighter", "mage", "ranger", "healer"]);
  });

  it("every skin and hair color carries a swatch hex", () => {
    for (const o of [...skins, ...hairColors]) {
      expect(o.swatch, `no swatch for ${o.id}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("includesId matches by id", () => {
    expect(includesId(skins, "light")).toBe(true);
    expect(includesId(skins, "chartreuse")).toBe(false);
  });
});
