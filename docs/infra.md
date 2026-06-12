# Infraestructura — doctabot (Alan)

> Dueño: **DevOps** (`/devops`). Fuente única de verdad de **cómo se deploya, dónde corre, qué env vars necesita y qué hacer cuando algo se rompe**.
> Última actualización: 2026-06-12.

## Hosting

| Parte | Dónde corre | Notas |
|-------|-------------|-------|
| **Frontend** (PWA React/Vite) | **VPS via Dokploy** (`server.ignaciopoletti.dev`) | Build con Dockerfile en el repo. **Auto-deploy con cada push a `main`** (Dokploy app "Doctabot", id `UjIs40YosJu3aFdyPt84R`, proyecto RemaxDocta, env production). Trigger manual: `POST /api/trpc/application.deploy` con `{"json":{"applicationId":"UjIs40YosJu3aFdyPt84R"}}`. |
| **Backend** (Edge Functions + Postgres) | **Supabase Cloud** | Proyecto **Doctabot** ref `osrphpndujdelfyetoah` (org QiuAutomations, región **sa-east-1**). |
| **DB** | Postgres de Supabase (`osrphpndujdelfyetoah`) | Esquema en `supabase/migrations/`. 44 migraciones aplicadas al 2026-06-12. |

## ⚠️ Situación de proyectos Supabase (importante)

Hay **dos** proyectos Supabase asociados a doctabot. No confundirlos:

| Proyecto | Ref | Estado | Acceso |
|----------|-----|--------|--------|
| **Doctabot** (prod actual) | `osrphpndujdelfyetoah` | ✅ **PROD EN VIVO** (cutover hecho ~2026-06-11). Org QiuAutomations. | MCP de Claude ✅ · CLI con `SUPABASE_ACCESS_TOKEN` ✅ |
| Lovable original (deprecado) | `pulaeosldsfcgyotolxa` | Viejo proyecto de Lovable. **Ya no es prod.** | ❌ Sin acceso (cuenta de Lovable, ni MCP ni PAT) |

**Gotcha:** el `supabase/config.toml` (`project_id`) y el `.env` local todavía apuntan al ref **viejo** (`pulaeosldsfcgyotolxa`). El front deployado en Dokploy ya usa el nuevo (cutover a nivel env de Dokploy). **Para cualquier deploy de Edge Function usar siempre `--project-ref osrphpndujdelfyetoah` explícito**, no confiar en el config.toml.

> TODO pendiente (Nacho/DevOps): actualizar `config.toml` `project_id` y el `.env` local al ref nuevo para evitar confusiones. No urgente (los deploys usan `--project-ref`).

## Deploy de Edge Functions

Requisitos: CLI `supabase` (instalado, v2.100.0) + `SUPABASE_ACCESS_TOKEN` en env (User scope, ya seteado). Docker NO es necesario para `functions deploy` (bundlea vía API).

```bash
# Deploy de la function chat (la principal — Alan)
supabase functions deploy chat --project-ref osrphpndujdelfyetoah
```

- El CLI bundlea `index.ts` + todo `supabase/functions/chat/_shared/**` automáticamente.
- `verify_jwt` se respeta desde `config.toml` (`[functions.chat] verify_jwt = false` — chat hace su propia auth en `authenticateRequest`).
- Otras functions deployadas en el proyecto: `google-calendar-auth`, `morning-matches`, `transcribe`, `admin-stats`, `scrape-properties`, `parse-client-import`, `send-push-notification`, `sync-calendar-event`, `test-webhook`.

### Verificación post-deploy

```bash
supabase functions list --project-ref osrphpndujdelfyetoah   # confirmar VERSION subió
```

Prueba funcional (con tráfico real en vivo): chequear que aparezcan filas nuevas post-deploy —
```sql
select max(created_at) from messages where role='assistant';
select max(created_at) from supervisor_logs;
```
Si hay filas con timestamp posterior al deploy → el flujo completo (turno + persistencia + supervisor background) funciona.

### Rollback de la function chat

El código viejo vive en git. Para revertir (~1 min):
```bash
git checkout <commit-previo> -- supabase/functions/chat
supabase functions deploy chat --project-ref osrphpndujdelfyetoah
git checkout main -- supabase/functions/chat
```
> Referencia: el deploy de streaming (chat v2, 2026-06-12) partió del merge `5d0001f`; el código previo bloqueante está en `26f9dfc`.

## Variables de entorno

### Frontend (Dokploy)
- `VITE_SUPABASE_URL` → `https://osrphpndujdelfyetoah.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (anon/publishable key del proyecto nuevo)

### Edge Function Secrets (Supabase → Edge Functions → Secrets)
Leídos en runtime con `Deno.env.get(...)`. **Nunca en el repo.** Necesarios para `chat`:
- `GEMINI_API_KEY` (la function usa `LOVABLE_API_KEY` como alias legacy del mismo valor)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Calendar/Gmail)
- `N8N_WEBHOOK_URL` (alertas del supervisor; opcional — si falta, no notifica)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto-inyectados por la plataforma)

> Confirmado seteados al 2026-06-12: `chat` responde 200 con tráfico real → `GEMINI_API_KEY` y Google creds presentes.

## Issues conocidos / runbook

- ✅ **`send-push-notification` 500 — RESUELTO 2026-06-12.** La migración había seteado una VAPID keypair distinta y con la private rota en el proyecto nuevo → `importVapidKeys` reventaba → 500. **Fix:** se regeneró una keypair VAPID nueva (web-push format), se setearon `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` en el proyecto nuevo, y se actualizó el fallback del front ([use-push-notifications.ts](../src/hooks/use-push-notifications.ts)). Public key nueva: `BMP92PAdZwTWRt_0CkGLXf3VOoC8dJCG-mizz1i4vnZzTlEYBNo6tYgv5XhA17phjted4yD3zwgFOsICad4Ve5c`.
  - ⚠️ **Consecuencia:** las subscriptions creadas con la keypair anterior quedaron inválidas (push service responde 403). **Los usuarios deben reactivar notificaciones** (toggle off/on) para re-suscribirse con la key nueva. Las 11 subs viejas seguirán dando 403 hasta que el usuario re-suscriba; conviene limpiarlas (`delete from push_subscriptions where created_at < '2026-06-12'`) para evitar ruido de 403.
  - Generar una VAPID keypair (si hace falta a futuro): `node` con `crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'})` → public = base64url(`0x04`||x||y) (65 bytes), private = jwk.d (32 bytes). **Nunca imprimir la private**; setear con `supabase secrets set --env-file`.
- ℹ️ **"No me llegó el push" puede ser supresión intencional (desde 2026-06-12, edge `chat` v5 + SW).** El backend (`chat/index.ts`) ahora dispara el push siempre que hay respuesta real (se eliminó la heurística `elapsed > 1.5s`); **quién decide MOSTRARLO es el service worker** (`src/sw.ts` → `isViewingConversation` de [push-visibility.ts](../src/lib/push-visibility.ts)). Si el usuario tiene una ventana **visible mirando esa misma conversación**, el SW **suprime** la notificación a propósito (no es bug — evita push redundante con lo que ya ve en pantalla). Se muestra si la app está en background/lock o el usuario está en otra conversación. Al debuggear: si `send-push-notification` devolvió 200 pero "no llegó", chequear si el cliente estaba en foco en esa conversación. La entrega real se loguea en `push_delivery_logs`; la supresión es client-side y **no** deja rastro en esa tabla.
- 🟠 **Security advisors (DB):** varias funciones `SECURITY DEFINER` (`admin_*`, `has_role`, `validate_invitation_code*`, `cleanup_old_logs`) son ejecutables por `anon`/`authenticated` vía RPC. Y "leaked password protection" está OFF en Auth. Heredados del clone. Revisar con Architect si amerita endurecer (revoke EXECUTE / SECURITY INVOKER).

## Monitoreo

- Logs de Edge Functions: Supabase Dashboard → Functions → Logs, o MCP `get_logs` (service `edge-function`).
- Calidad de Alan: tabla `supervisor_logs` (verdict/score/reason por turno — el supervisor post-hoc loguea cada turno). Ver [ADR-001](./adrs/0001-supervisor-post-hoc-streaming.md).
- **No hay Sentry ni uptime monitoring configurado** todavía → TODO de observabilidad.
