import { useCallback, useEffect, useReducer, useState } from "react";
import {
  detectIsIOS,
  detectIsStandalone,
  runInstallPrompt,
  getDeferredPrompt,
  clearDeferredPrompt,
  subscribeInstall,
  type PromptOutcome,
} from "@/lib/pwa";

const BANNER_DISMISSED_KEY = "fq.pwa.bannerDismissed";

export interface PwaInstall {
  /** A beforeinstallprompt event is available and we're not already installed. */
  canInstall: boolean;
  /** Already running as an installed app. */
  isStandalone: boolean;
  /** iOS/iPadOS, where install is a manual "Add to Home Screen". */
  isIOS: boolean;
  /** iOS + not installed + banner not dismissed → show manual instructions. */
  showIosHint: boolean;
  bannerDismissed: boolean;
  promptInstall: () => Promise<PromptOutcome>;
  dismissBanner: () => void;
}

export function usePwaInstall(): PwaInstall {
  // Re-render whenever the shared install holder changes.
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeInstall(forceRender), []);

  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BANNER_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const isStandalone =
    typeof window !== "undefined" &&
    detectIsStandalone(
      window.matchMedia?.("(display-mode: standalone)").matches ?? false,
      (navigator as Navigator & { standalone?: boolean }).standalone,
    );

  const isIOS =
    typeof navigator !== "undefined" &&
    detectIsIOS(navigator.userAgent, navigator.maxTouchPoints);

  const canInstall = getDeferredPrompt() !== null && !isStandalone;
  const showIosHint = isIOS && !isStandalone && !bannerDismissed;

  const promptInstall = useCallback(async (): Promise<PromptOutcome> => {
    const outcome = await runInstallPrompt(getDeferredPrompt());
    if (outcome !== "unavailable") clearDeferredPrompt();
    return outcome;
  }, []);

  const dismissBanner = useCallback(() => {
    try {
      localStorage.setItem(BANNER_DISMISSED_KEY, "1");
    } catch {
      /* ignore private-mode storage errors */
    }
    setBannerDismissed(true);
  }, []);

  return {
    canInstall,
    isStandalone,
    isIOS,
    showIosHint,
    bannerDismissed,
    promptInstall,
    dismissBanner,
  };
}
