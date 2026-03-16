import { useState, useEffect, useCallback } from "react";

/**
 * Detects when a new Service Worker is waiting to activate.
 * Auto-applies the update immediately without user intervention.
 * Still exposes `updateAvailable` and `applyUpdate` as fallback.
 */
export function useSwUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  const applyUpdate = useCallback(async (worker?: ServiceWorker | null) => {
    const sw = worker ?? waitingWorker;
    // Tell the waiting SW to skip waiting
    if (sw) {
      sw.postMessage({ type: "SKIP_WAITING" });
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

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const autoUpdate = (worker: ServiceWorker) => {
      console.log("[SW] New version detected, auto-updating...");
      setWaitingWorker(worker);
      setUpdateAvailable(true);
      // Small delay to let any in-flight requests finish
      setTimeout(() => applyUpdate(worker), 1500);
    };

    const checkRegistration = async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;

      // If there's already a waiting worker, auto-update
      if (reg.waiting) {
        autoUpdate(reg.waiting);
      }

      // Listen for new SW installs
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            autoUpdate(newWorker);
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
  }, [applyUpdate]);

  return { updateAvailable, applyUpdate };
}
