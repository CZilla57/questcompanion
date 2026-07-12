import { describe, it, expect } from "vitest";
import { CATEGORIES, CATEGORY_COLORS, CATEGORY_HEX_COLORS, CATEGORY_LABEL } from "./categories";

describe("category catalog integrity", () => {
  it("has a color, hex, and label for every category slug", () => {
    for (const { slug } of CATEGORIES) {
      expect(CATEGORY_COLORS[slug], `color for ${slug}`).toBeTruthy();
      expect(CATEGORY_HEX_COLORS[slug], `hex for ${slug}`).toBeTruthy();
      expect(CATEGORY_LABEL[slug], `label for ${slug}`).toBeTruthy();
    }
  });

  it("includes the three new categories", () => {
    const slugs = CATEGORIES.map((c) => c.slug);
    expect(slugs).toContain("self_care");
    expect(slugs).toContain("errands");
    expect(slugs).toContain("travel");
  });
});
