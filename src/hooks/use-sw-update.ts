import { useState, useEffect, useCallback } from "react";

/**
 * Detects when a new Service Worker is waiting to activate.
 * Uses non-destructive lifecycle: sends SKIP_WAITING and waits for
 * controllerchange before reloading. NEVER unregisters the SW,
 * because that destroys push subscriptions.
 */
export function useSwUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const applyUpdate = useCallback(async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    const waiting = reg?.waiting;
    if (waiting) {
      waiting.postMessage({ type: "SKIP_WAITING" });
      // The SW already calls self.skipWaiting() on install, but this
      // is a belt-and-suspenders approach. The controllerchange listener
      // below will trigger the reload once the new SW takes over.
    }
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reloading = false;

    // Reload once when a new SW takes control — only once per page load
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const checkRegistration = async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;

      // If there's already a waiting worker, apply it
      if (reg.waiting) {
        setUpdateAvailable(true);
        // Small delay to let any in-flight requests finish
        setTimeout(() => {
          reg.waiting?.postMessage({ type: "SKIP_WAITING" });
        }, 1500);
      }

      // Listen for new SW installs
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            console.log("[SW] New version detected, activating…");
            setUpdateAvailable(true);
            setTimeout(() => {
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }, 1500);
          }
        });
      });
    };

    checkRegistration();

    // Periodically check for updates (every 60s)
    const interval = setInterval(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      reg?.update();
    }, 60_000);

    return () => {
      clearInterval(interval);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return { updateAvailable, applyUpdate };
}
