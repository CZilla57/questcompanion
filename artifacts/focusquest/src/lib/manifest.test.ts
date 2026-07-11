import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const publicDir = path.resolve(import.meta.dirname, "..", "..", "public");
const manifest = JSON.parse(
  readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf8"),
);

describe("web app manifest", () => {
  it("has the required installability fields", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(manifest.display);
  });

  it("declares 192 and 512 icons plus a maskable variant", () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose);
    expect(purposes).toContain("maskable");
  });

  it("references icon files that exist on disk", () => {
    for (const icon of manifest.icons as { src: string }[]) {
      const rel = icon.src.replace(/^\//, "");
      expect(existsSync(path.join(publicDir, rel)), `${icon.src} missing`).toBe(true);
    }
  });
});
