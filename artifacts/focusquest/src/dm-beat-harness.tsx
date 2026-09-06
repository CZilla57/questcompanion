// DEV-ONLY harness for the Dungeon Master beat card. Renders DmBeatView in
// isolation — no auth, no API — in both the morning and evening states.
// Run the dev server and open http://localhost:5173/dm-beat-harness.html
// Not part of the production build (Vite only bundles files referenced by index.html).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DmBeatView } from "@/components/dm-beat-card";
import "./index.css";

const MORNING = 'The morning sun greets your twelfth day of steady progress, and the board awaits with "Take morning medication", "Morning stretches", and "Wash bottles" whenever you feel ready to begin.';
const CAMP = 'Camp is struck for the evening. You cleared "Wash bottles" and two more — the Forge reached Outpost. Rest well; it counts.';

function Harness() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem" }} className="space-y-6">
      <p className="cap">morning · quest board</p>
      <DmBeatView kind="morning" narrative={MORNING} />
      <p className="cap">evening · make camp</p>
      <DmBeatView kind="camp" narrative={CAMP} />
    </div>
  );
}

createRoot(document.getElementById("harness")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
