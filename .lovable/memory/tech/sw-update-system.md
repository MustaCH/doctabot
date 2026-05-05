---
name: SW Auto Update
description: Non-destructive SW update — NEVER unregister, use skipWaiting + controllerchange reload
type: preference
---
- useSwUpdate sends SKIP_WAITING to waiting worker, then reloads on controllerchange
- NEVER unregister the SW — that destroys push subscriptions
- SW already calls self.skipWaiting() on install + self.clients.claim() on activate
- persistSubscription cleans stale endpoints for same user before upserting
- Push notifications tagged with trigger_source ("chat", "morning-matches")
