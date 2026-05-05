## Problem

Push notifications are never received despite 224 successful deliveries (HTTP 201 from Apple/FCM). The issue is the `useSwUpdate` hook: it **unregisters ALL service workers** on every app update, destroying the push subscription in the process. Apple/FCM still accept pushes to the old endpoint (201), but no SW exists to handle the `push` event, so the notification never shows.

## Plan

### 1. Fix `useSwUpdate` — stop destroying the SW

Replace the destructive `applyUpdate` (unregister all SWs + clear caches + reload) with a proper SW lifecycle approach:
- Send `SKIP_WAITING` to the waiting worker (which the SW already handles via `self.skipWaiting()`)
- Listen for `controllerchange` to reload only when the new SW takes over
- **Never unregister** the service worker — that kills push subscriptions

File: `src/hooks/use-sw-update.ts`

### 2. Clean up stale push subscriptions

Add cleanup logic: when re-subscribing, delete the previous endpoint from the database so stale endpoints don't accumulate.

The old subscription for user `e4269c23` from April 20th (no device_label, no is_standalone) is stale and should be cleaned up.

File: `src/hooks/use-push-notifications.ts`

### 3. Add a `trigger_source` to chat push calls

Tag push notifications sent from the chat function with `trigger_source: "chat"` so delivery logs are traceable.

File: `supabase/functions/chat/_shared/notifications.ts`

### 4. Clean stale subscription from DB

Remove the orphaned subscription for user `e4269c23` (the one from April 20th with no device_label).

### Technical details

The SW (`src/sw.ts`) already calls `self.skipWaiting()` on install and `self.clients.claim()` on activate, which means updates activate immediately without needing external intervention. The `useSwUpdate` hook's aggressive unregister/reload cycle was fighting against this built-in behavior.

Files to modify:
- `src/hooks/use-sw-update.ts` — Non-destructive update flow
- `src/hooks/use-push-notifications.ts` — Clean old subscriptions on re-subscribe
- `supabase/functions/chat/_shared/notifications.ts` — Add trigger_source
