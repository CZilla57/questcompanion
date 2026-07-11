// Pure, framework-free helpers for PWA install decisions, plus a tiny
// module-level holder for the (single-use) beforeinstallprompt event.
// The React hook (use-pwa-install.ts) wires browser globals into these.

export type PromptOutcome = "accepted" | "dismissed" | "unavailable";

/** The subset of the non-standard BeforeInstallPromptEvent we rely on. */
export interface InstallPromptEvent {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** True on iOS/iPadOS, where install is manual (no beforeinstallprompt event). */
export function detectIsIOS(userAgent: string, maxTouchPoints = 0): boolean {
  const ua = userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ presents a desktop "Macintosh" UA; disambiguate via touch.
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

/** True when already running installed (standalone display). */
export function detectIsStandalone(
  matchStandalone: boolean,
  navigatorStandalone: boolean | undefined,
): boolean {
  return matchStandalone || navigatorStandalone === true;
}

/** Run the browser install prompt (if any) and normalize the result. */
export async function runInstallPrompt(
  event: InstallPromptEvent | null,
): Promise<PromptOutcome> {
  if (!event) return "unavailable";
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

// --- beforeinstallprompt holder -------------------------------------------
// The event is single-use and can fire before React mounts, so we capture it
// at module scope (primed from main.tsx) and let hooks subscribe for changes.

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function primeInstallCapture(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as unknown as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

export function getDeferredPrompt(): InstallPromptEvent | null {
  return deferredPrompt;
}

export function clearDeferredPrompt(): void {
  deferredPrompt = null;
  notify();
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
