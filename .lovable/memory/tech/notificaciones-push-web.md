---
name: Web Push Notifications
description: VAPID push system unified into single SW (PWA + push), with iOS standalone detection and device metadata
type: feature
---
- VAPID key fetched dynamically from `send-push-notification` (action: `get_vapid_key`).
- **Single Service Worker**: PWA strategy is `injectManifest` (vite-plugin-pwa), `src/sw.ts` handles BOTH workbox precache AND push/notificationclick. The legacy `public/sw-push.js` was removed; `src/main.tsx` unregisters any leftover `/sw-push.js` registration on boot.
- Why unified: previously two SWs competed for root scope, leaving iOS in a state where Apple accepted pushes (HTTP 201) but no `push` listener was active, so notifications never appeared.
- iOS Web Push requires **iOS 16.4+** AND the app to be installed to Home Screen (standalone mode). The `usePushNotifications` hook returns `capability.status`: `supported | ios-needs-install | ios-too-old | unsupported`.
- Profile UI shows contextual messages depending on capability status. Switch is disabled when not `supported`.
- `push_subscriptions` table extended with: `user_agent`, `platform`, `is_standalone`, `device_label`, `last_seen_at` — populated on every subscribe/refresh. Super Admin push panel shows per-device detail.
- On VapidPkHashMismatch / 410 / 404: subscription is auto-pruned and logged in `push_delivery_logs`.
- "Aceptada" in admin panel = HTTP 201 from push service, NOT guaranteed display on iOS.
- Push URL uses `/?c=<conversationId>` — Chat.tsx reads `?c=` to open the conversation.
- Push sent when chat response takes >1.5s (fire-and-forget from chat edge function).
