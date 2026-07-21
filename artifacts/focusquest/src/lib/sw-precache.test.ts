import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The script is plain mjs (it runs post-vite-build, outside the src graph);
// import it relative to this test file.
const scriptUrl = new URL("../../scripts/inject-sw-precache.mjs", import.meta.url);

let collectPrecache: (dist: string) => { assets: string[]; hash: string; totalBytes: number };
let injectIntoSw: (src: string, m: { hash: string; assets: string[] }) => string;

beforeAll(async () => {
  const mod = await import(scriptUrl.href);
  collectPrecache = mod.collectPrecache;
  injectIntoSw = mod.injectIntoSw;
});

const MARKER = 'const BUILD = { hash: "dev", assets: [] }; // replaced at build time by scripts/inject-sw-precache.mjs';

function makeFixtureDist(): string {
  const dist = mkdtempSync(path.join(tmpdir(), "fq-dist-"));
  writeFileSync(path.join(dist, "index.html"), "<html>app</html>");
  writeFileSync(path.join(dist, "manifest.webmanifest"), "{}");
  writeFileSync(path.join(dist, "favicon.svg"), "<svg/>");
  writeFileSync(path.join(dist, "sw.js"), MARKER + "\nrest();");
  writeFileSync(path.join(dist, "opengraph.jpg"), "jpg");
  writeFileSync(path.join(dist, "robots.txt"), "x");
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "assets", "index-Abc123.js"), "js");
  writeFileSync(path.join(dist, "assets", "index-Def456.css"), "css");
  mkdirSync(path.join(dist, "assets", "nested"));
  writeFileSync(path.join(dist, "assets", "nested", "deep.js"), "nested");
  mkdirSync(path.join(dist, "icons"));
  writeFileSync(path.join(dist, "icons", "icon-192.png"), "png");
  mkdirSync(path.join(dist, "lpc"));
  writeFileSync(path.join(dist, "lpc", "huge-sheet.png"), "megabytes of sprites");
  return dist;
}

describe("collectPrecache", () => {
  let dist: string;
  beforeAll(() => { dist = makeFixtureDist(); });
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it("lists the shell: index.html, manifest, favicon, assets/*, icons/*", () => {
    const { assets } = collectPrecache(dist);
    expect(assets).toContain("/index.html");
    expect(assets).toContain("/manifest.webmanifest");
    expect(assets).toContain("/favicon.svg");
    expect(assets).toContain("/assets/index-Abc123.js");
    expect(assets).toContain("/assets/index-Def456.css");
    expect(assets).toContain("/icons/icon-192.png");
  });

  it("excludes art dirs, sw.js itself, opengraph and robots (capture-mode shell only)", () => {
    const { assets } = collectPrecache(dist);
    expect(assets.some((a) => a.startsWith("/lpc/"))).toBe(false);
    expect(assets).not.toContain("/sw.js");
    expect(assets).not.toContain("/opengraph.jpg");
    expect(assets).not.toContain("/robots.txt");
    expect(assets.some((a) => a.includes("/nested/"))).toBe(false);
  });

  it("hash is deterministic and changes when index.html content changes", () => {
    const first = collectPrecache(dist).hash;
    expect(collectPrecache(dist).hash).toBe(first);
    writeFileSync(path.join(dist, "index.html"), "<html>app v2</html>");
    expect(collectPrecache(dist).hash).not.toBe(first);
  });

  it("reports total bytes for the size budget log", () => {
    expect(collectPrecache(dist).totalBytes).toBeGreaterThan(0);
  });
});

describe("injectIntoSw", () => {
  it("replaces the BUILD marker with the manifest", () => {
    const out = injectIntoSw(MARKER + "\nrest();", { hash: "abc123def456", assets: ["/index.html"] });
    expect(out).toContain('"hash":"abc123def456"');
    expect(out).toContain('"/index.html"');
    expect(out).not.toContain('hash: "dev"');
    expect(out).toContain("rest();");
  });

  it("throws when the marker is missing (a template drift must fail the build)", () => {
    expect(() => injectIntoSw("nothing here", { hash: "x", assets: [] })).toThrow(/marker/i);
  });
});

describe("public/sw.js template", () => {
  it("carries the exact marker line the build replaces", () => {
    const swPath = fileURLToPath(new URL("../../public/sw.js", import.meta.url));
    expect(readFileSync(swPath, "utf8")).toContain(MARKER);
  });
});
