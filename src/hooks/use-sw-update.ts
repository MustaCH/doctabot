import { useState, useEffect, useCallback } from "react";

/**
 * Detects when a new Service Worker is waiting to activate.
 * Returns `updateAvailable` flag and an `applyUpdate` function
 * that clears caches and reloads the app.
 */
export function useSwUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const checkRegistration = async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;

      // If there's already a waiting worker
      if (reg.waiting) {
        setWaitingWorker(reg.waiting);
        setUpdateAvailable(true);
      }

      // Listen for new SW installs
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            setWaitingWorker(newWorker);
            setUpdateAvailable(true);
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

    return () => clearInterval(interval);
  }, []);

  const applyUpdate = useCallback(async () => {
    // Tell the waiting SW to skip waiting
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    }

    // Clear all caches
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }

    // Unregister the old SW and reload
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));

    window.location.reload();
  }, [waitingWorker]);

  return { updateAvailable, applyUpdate };
}
