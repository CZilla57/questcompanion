import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { primeInstallCapture } from "@/lib/pwa";

// Capture beforeinstallprompt as early as possible (before React mounts).
primeInstallCapture();

// Register the service worker on load so the app is installable. This is
// independent of push: useNotifications still registers on demand, and
// register() is idempotent so the two never conflict.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
