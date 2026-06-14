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

// ---- Push notifications ----
self.addEventListener("push", (event: PushEvent) => {
  let data: { title?: string; body?: string; url?: string } = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      // Payload no-JSON (o indescifrable): intentar como texto, sin romper el handler.
      try {
        data = { body: event.data.text() };
      } catch {
        data = {};
      }
    }
  }

  const title = data.title || "Alan";
  const targetUrl = data.url || "/";
  const options: NotificationOptions = {
    body: data.body || "",
    icon: "/alan-192.png",
    badge: "/alan-192.png",
    data: { url: targetUrl },
  };

  event.waitUntil(
    (async () => {
      // Señal real de foco/visibilidad (en el momento de la entrega): si el usuario ya
      // está mirando esta conversación, el push es redundante y no lo mostramos. Si la
      // app está en background/lock o está en otra conversación, sí lo mostramos.
      const convId = conversationIdFromUrl(targetUrl);
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const viewing = isViewingConversation(
        clients.map((c) => ({ visibilityState: c.visibilityState, url: c.url })),
        convId,
      );
      if (viewing) return;
      try {
        await self.registration.showNotification(title, options);
      } catch (err) {
        console.error("[sw] showNotification falló:", err);
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
