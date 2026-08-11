// DEV-ONLY harness for the hero sprite animation. Renders PixelHero in isolation — no auth, no API.
// Run the dev server and open http://localhost:5173/hero-harness.html
// Not part of the production build (Vite only bundles files referenced by index.html).
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PixelHero } from "@/components/pixel-hero";
import type { HeroLook } from "@/lib/hero/types";

const base: HeroLook = {
  skin: "light", build: "male", hairStyle: "short", hairColor: "brown",
  face: "neutral", beardStyle: "none", beardColor: "black",
  glasses: "none", earrings: "none",
  avatarClass: "fighter", tier: 0, equipped: [],
};

// Varied looks: exercises recolored cloth (t0 shoes/pants/robes), robes (mage/healer), and tinted gear.
const looks: { cap: string; look: HeroLook }[] = [
  { cap: "fighter t0 (cloth)", look: { ...base, avatarClass: "fighter", tier: 0 } },
  { cap: "ranger t0 (cloth)", look: { ...base, avatarClass: "ranger", tier: 0 } },
  { cap: "mage t0 (robe)", look: { ...base, avatarClass: "mage", tier: 0 } },
  { cap: "healer t0 (robe)", look: { ...base, avatarClass: "healer", tier: 0 } },
  { cap: "fighter t3 (plate)", look: { ...base, avatarClass: "fighter", tier: 3 } },
  { cap: "mage t3 (dark robe)", look: { ...base, avatarClass: "mage", tier: 3, build: "female" } },
  {
    cap: "gear: sword+cap (rare)",
    look: {
      ...base, avatarClass: "fighter", tier: 1,
      equipped: [
        { slot: "weapon", spriteId: "sword", rarity: "rare" },
        { slot: "helmet", spriteId: "cap", rarity: "epic" },
        { slot: "accessory", spriteId: "cape", rarity: "legendary" },
      ],
    },
  },
  {
    cap: "gear: staff+crown (legendary)",
    look: {
      ...base, avatarClass: "mage", tier: 2, build: "female",
      equipped: [
        { slot: "weapon", spriteId: "archmage-staff", rarity: "legendary" },
        { slot: "helmet", spriteId: "crown", rarity: "legendary" },
      ],
    },
  },
];

function Harness() {
  const [mounted, setMounted] = useState(true);
  const [stress, setStress] = useState(false);

  return (
    <div>
      <section>
        <h1>1 · Idle animation + recolored cloth / robes / tinted gear</h1>
        <p className="cap">Each hero should loop an in-place idle motion. Cloth (shoes/pants) and robe
          colors should differ per class; rare/epic/legendary gear should carry a blue/purple/amber tint.</p>
        <div className="row">
          {looks.map((l, i) => (
            <div className="cell" key={i}>
              <PixelHero look={l.look} size={96} />
              <span className="cap">{l.cap}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h1>2 · Task-completion flourish (dashboard hero)</h1>
        <p className="cap">Only this hero has <code>celebrateOn="questCompleted"</code>. Click the button
          (fires the real global <code>quest-completed</code> event): it should scale-pop with a sparkle
          burst from the CENTER, then settle. Click rapidly to confirm a re-trigger restarts cleanly.</p>
        <div className="row">
          <div className="cell">
            <PixelHero look={{ ...base, avatarClass: "healer", tier: 1 }} size={160} celebrateOn="questCompleted" />
            <span className="cap">celebrateOn hero</span>
          </div>
          <button onClick={() => window.dispatchEvent(new CustomEvent("quest-completed"))}>
            Complete a quest →
          </button>
        </div>
      </section>

      <section>
        <h1>3 · Mount / unmount (lifecycle + GPU cleanup)</h1>
        <p className="cap">Toggle a few times. It should mount/unmount without console errors and without
          GPU memory growth (shared renderer frees each slot's RenderTexture on unmount).</p>
        <div className="row">
          <button onClick={() => setMounted((m) => !m)}>{mounted ? "Unmount" : "Mount"}</button>
          {mounted && <PixelHero look={{ ...base, avatarClass: "ranger", tier: 2 }} size={96} />}
        </div>
      </section>

      <section>
        <h1>4 · Many instances (single WebGL context)</h1>
        <p className="cap">Render 32 heroes at once — the whole point of the shared renderer. There should
          be NO "Too many active WebGL contexts" console warning, and all 32 should animate. (Before the
          shared-renderer fix, 32 separate contexts would blow the browser's ~16 cap.)</p>
        <button onClick={() => setStress((s) => !s)}>{stress ? "Hide" : "Show"} 32 heroes</button>
        {stress && (
          <div className="grid" style={{ marginTop: "0.75rem" }}>
            {Array.from({ length: 32 }, (_, i) => (
              <PixelHero
                key={i}
                size={48}
                look={{ ...base, avatarClass: (["fighter", "mage", "ranger", "healer"] as const)[i % 4], tier: (i % 4) as 0 | 1 | 2 | 3 }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

createRoot(document.getElementById("harness")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
