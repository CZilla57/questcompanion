import { useState } from "react";
import { Download, X, Share } from "lucide-react";
import { Button } from "./ui/button";
import { usePwaInstall } from "@/hooks/use-pwa-install";

export function InstallBanner() {
  const {
    canInstall,
    showIosHint,
    isIOS,
    isStandalone,
    bannerDismissed,
    promptInstall,
    dismissBanner,
  } = usePwaInstall();
  const [showSteps, setShowSteps] = useState(false);

  if (isStandalone || bannerDismissed) return null;
  if (!canInstall && !showIosHint) return null;

  const handleInstall = async () => {
    if (isIOS) {
      setShowSteps(true);
      return;
    }
    const outcome = await promptInstall();
    if (outcome === "accepted") dismissBanner();
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-primary/30 bg-card/80 p-3 backdrop-blur-sm">
      <div className="shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
        <Download className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Install FocusQuest</p>
        <p className="text-xs text-muted-foreground">
          Add it to your home screen for a full-screen, app-like experience.
        </p>
        {showSteps ? (
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Share className="h-3.5 w-3.5" /> Tap Share, then “Add to Home Screen”.
          </p>
        ) : (
          <Button size="sm" className="mt-2 h-8" onClick={handleInstall}>
            {isIOS ? "How to install" : "Install"}
          </Button>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground"
        aria-label="Dismiss install banner"
        onClick={dismissBanner}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
