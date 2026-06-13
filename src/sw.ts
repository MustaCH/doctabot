/// <reference lib="webworker" />
// Single, unified service worker.
//   - Workbox precaches the PWA shell (injected by vite-plugin-pwa)
//   - Same worker also receives `push` and `notificationclick` events
//
// Having ONE worker prevents the previous bug where the PWA-generated SW
// would claim the root scope and discard the manual /sw-push.js, leaving
// iOS in a state where Apple accepted pushes (201) but no notification
// was ever shown (no active worker had a `push` listener).

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { conversationIdFromUrl, isViewingConversation } from "./lib/push-visibility";

declare const self: ServiceWorkerGlobalScope;

// Precache assets injected at build time
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// SPA navigation fallback (excluding OAuth callback paths)
registerRoute(
  new NavigationRoute(
    async ({ event }) => {
      try {
        const cache = await caches.open("workbox-precache");
        const cached = await cache.match("/index.html");
        if (cached) return cached;
      } catch {
        // ignore
      }
      return fetch((event as FetchEvent).request);
    },
    { denylist: [/^\/~oauth/, /\/google-calendar-auth/] }
  )
);

// Activate immediately on update — matches old behavior
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ---- Push notifications (DIAGNOSTIC BUILD — bug 86aj18u6f, REVERTIR tras debug) ----
// Temporal: siempre muestra una notificación con el contenido descifrado adentro,
// sin supresión, para ver en qué paso muere el push real.
self.addEventListener("push", (event: PushEvent) => {
  event.waitUntil(
    (async () => {
      const dbg: Record<string, unknown> = {
        perm: (self as unknown as { Notification?: { permission: string } }).Notification?.permission ?? "n/a",
        hasData: !!event.data,
      };
      let data: { title?: string; body?: string; url?: string } = {};
      try {
        data = event.data ? event.data.json() : {};
        dbg.parsed = data;
      } catch (e) {
        dbg.jsonErr = (e as Error)?.message ?? String(e);
        try {
          dbg.text = event.data?.text()?.slice(0, 80);
        } catch (e2) {
          dbg.textErr = (e2 as Error)?.message ?? String(e2);
        }
      }

      const targetUrl = data.url || "/";
      const convId = conversationIdFromUrl(targetUrl);
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      dbg.convId = convId;
      dbg.clients = clients.length;
      dbg.viewing = isViewingConversation(
        clients.map((c) => ({ visibilityState: c.visibilityState, url: c.url })),
        convId,
      );

      console.log("[push-dbg]", dbg);
      try {
        await self.registration.showNotification("DEBUG: " + (data.title ?? "sin-title"), {
          body: JSON.stringify(dbg).slice(0, 250),
        });
      } catch (e) {
        console.log("[push-dbg] showNotification ERROR:", (e as Error)?.message, dbg);
      }
    })()
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url || "/";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          await (client as WindowClient).navigate(url);
          return (client as WindowClient).focus();
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});

export {};
