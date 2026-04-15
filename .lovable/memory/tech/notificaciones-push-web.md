---
name: Web Push Notifications
description: VAPID push system with dynamic key fetch, aes128gcm encryption, foreground recovery
type: feature
---
- VAPID key is fetched dynamically from `send-push-notification` edge function (action: `get_vapid_key`) to prevent client/server mismatch
- Client hardcoded fallback key exists but server key takes priority
- On subscribe, old subscriptions are unsubscribed first to avoid VapidPkHashMismatch
- Push URL uses `/?c=<conversationId>` (not `/chat?c=...`)
- Chat.tsx reads `?c=` search param on mount to open the correct conversation from a notification
- `use-chat-messages.ts` reloads from DB whenever app returns to foreground after being hidden >2s or after stream interruption
- Message separator: `===MSG_BREAK===` (with legacy `---` fallback for old DB records)
- Chat edge function fallback path now uses non-streaming generation + DB persistence (no more raw stream passthrough)
- Push sent when response takes >3s (fire-and-forget from chat edge function)
