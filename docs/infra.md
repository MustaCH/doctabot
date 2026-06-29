# Infraestructura — doctabot (Alan)

> Dueño: **DevOps** (`/devops`). Fuente única de verdad de **cómo se deploya, dónde corre, qué env vars necesita y qué hacer cuando algo se rompe**.
> Última actualización: 2026-06-18.

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

✅ **Alineación de refs cerrada (2026-06-14, ticket [86aj18qva]):** `supabase/config.toml` (`project_id`) **ya apunta** a `osrphpndujdelfyetoah` y el `.env` local fue actualizado al ref nuevo (URL + anon key del proyecto Doctabot). No queda ningún rastro del ref viejo en el repo (grep limpio; no hay workflows de CI que dependan de él). Un `supabase functions deploy <slug>` **sin** `--project-ref` ahora apunta al proyecto correcto — igual conviene seguir pasándolo explícito por costumbre.

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
- `N8N_WEBHOOK_URL` (opcional — si falta, no notifica). Canal de **telemetría cruda** a n8n: alertas del supervisor del chat (`chat/_shared/notifications.ts`) + pings de observabilidad (`observability.ts` → `edge_error`, `report-error` → `frontend_error`, `health-monitor` → `uptime_alert`). **El scraper ya NO lo usa** para sus avisos de corrida — ver `OVERLORD_TOKEN`.
- `OVERLORD_TOKEN` (✅ **seteado en prod, confirmado 2026-06-18**; si faltara, el scraper no avisa pero no rompe). Token del **endpoint de Intake de OVERLORD** (`X-Overlord-Token`). Lo usa `scrape-properties` → `runCleanup` para notificar cada corrida (ver "Jobs programados y scraper"). Contrato: `OVERLORD/INSTRUCTIONS.md` §7.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto-inyectados por la plataforma)

> Confirmado seteados al 2026-06-12: `chat` responde 200 con tráfico real → `GEMINI_API_KEY` y Google creds presentes.

## Issues conocidos / runbook

- ✅ **`send-push-notification` 500 — RESUELTO 2026-06-12.** La migración había seteado una VAPID keypair distinta y con la private rota en el proyecto nuevo → `importVapidKeys` reventaba → 500. **Fix:** se regeneró una keypair VAPID nueva (web-push format), se setearon `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` en el proyecto nuevo, y se actualizó el fallback del front ([use-push-notifications.ts](../src/hooks/use-push-notifications.ts)). Public key nueva: `BMP92PAdZwTWRt_0CkGLXf3VOoC8dJCG-mizz1i4vnZzTlEYBNo6tYgv5XhA17phjted4yD3zwgFOsICad4Ve5c`.
  - ⚠️ **Consecuencia:** las subscriptions creadas con la keypair anterior quedaron inválidas (push service responde 403). **Los usuarios deben reactivar notificaciones** (toggle off/on) para re-suscribirse con la key nueva. Las 11 subs viejas seguirán dando 403 hasta que el usuario re-suscriba; conviene limpiarlas (`delete from push_subscriptions where created_at < '2026-06-12'`) para evitar ruido de 403.
  - Generar una VAPID keypair (si hace falta a futuro): `node` con `crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'})` → public = base64url(`0x04`||x||y) (65 bytes), private = jwk.d (32 bytes). **Nunca imprimir la private**; setear con `supabase secrets set --env-file`.
- 🟠 **`send-push-notification` corre con `verify_jwt: true` en prod → rompe el sync de la VAPID key (detectado 2026-06-13, bug 86aj18u6f).** El front llama a `get_vapid_key` **sin** `Authorization` para mantenerse en sync con la public key del server; con `verify_jwt: true` el gateway lo rechaza (401) y el front cae al **fallback hardcodeado** ([use-push-notifications.ts](../src/hooks/use-push-notifications.ts)). Mientras el fallback == la env del server (hoy ambos `BMP92…`) funciona, pero es frágil: un bundle cacheado con un fallback viejo crea subs con una key que no matchea → push service responde **403** ("the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions"). **Fix staged:** se agregó `[functions.send-push-notification] verify_jwt = false` a `config.toml`. **Requiere redeploy** (lo corre Nacho): `supabase functions deploy send-push-notification --project-ref osrphpndujdelfyetoah`. Los dispatchers (`chat`, `morning-matches`) llaman con service key, así que `verify_jwt=false` no los afecta.
  - **Cómo verificar la VAPID key del server** (read-only, sin tocar secrets): `get_vapid_key` con un bearer válido (anon key del proyecto sirve, pasa el `verify_jwt`):
    ```bash
    curl -s -X POST "https://osrphpndujdelfyetoah.supabase.co/functions/v1/send-push-notification" \
      -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" \
      -d '{"action":"get_vapid_key"}'
    ```
    Debe devolver la misma public key que el fallback del front. Si difieren → mismatch → 403 garantizado.
  - **Subs rancias = 403, no se prunean solas.** El dispatch sólo prunea en 410/404/400-VapidPk; un **403** se loguea como `failed` y la sub queda. Diagnóstico por device: cruzar `push_subscriptions.endpoint` con `push_delivery_logs.endpoint_preview` (`left(endpoint,80)`) y mirar el último `status`/`http_status`. Un 201 = el server entregó OK (si no se vio, es supresión client-side); un 403 = sub creada con key vieja → borrarla y re-suscribir con bundle fresco.
- 🔴 **CAUSA RAÍZ del "201 pero no se muestra" — falta policy UPDATE en `push_subscriptions` (detectado 2026-06-13, bug 86aj18u6f).** La tabla tiene RLS para DELETE/INSERT/SELECT pero **no para UPDATE**. El hook hace `upsert(..., {onConflict:"endpoint"})`: la primera activación (endpoint nuevo) inserta OK, pero **re-activar con el mismo endpoint dispara un UPDATE → 403** (visible en consola del navegador como `push_subscriptions?on_conflict=endpoint 403`). La fila no se actualiza → quedan `p256dh`/`auth` viejos → el server cifra con keys que el navegador no puede descifrar → FCM/Apple devuelven **201** pero el SW falla al descifrar y **no muestra nada**. `persistSubscription` además **no chequea el error** del upsert, así que falla en silencio y la UI muestra "activado". **Fix (migración, la aplica Nacho/backend):** `create policy "Users can update own push subscriptions" on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());`. Verificación: re-activar notificaciones y confirmar que el request a `push_subscriptions` da 200/201 (no 403), después un push de prueba debe mostrarse.
- 🟠 **Push es mono-dispositivo por bug del front (detectado 2026-06-13, bug 86aj18u6f → derivado a /backend).** `persistSubscription` borra todas las subs del user con endpoint distinto antes de upsertear ([use-push-notifications.ts:124](../src/hooks/use-push-notifications.ts)) → activar en un device **mata** la sub de los demás. No es infra; lo arregla Backend.
- ℹ️ **"No me llegó el push" puede ser supresión intencional (desde 2026-06-12, edge `chat` v5 + SW).** El backend (`chat/index.ts`) ahora dispara el push siempre que hay respuesta real (se eliminó la heurística `elapsed > 1.5s`); **quién decide MOSTRARLO es el service worker** (`src/sw.ts` → `isViewingConversation` de [push-visibility.ts](../src/lib/push-visibility.ts)). Si el usuario tiene una ventana **visible mirando esa misma conversación**, el SW **suprime** la notificación a propósito (no es bug — evita push redundante con lo que ya ve en pantalla). Se muestra si la app está en background/lock o el usuario está en otra conversación. Al debuggear: si `send-push-notification` devolvió 200 pero "no llegó", chequear si el cliente estaba en foco en esa conversación. La entrega real se loguea en `push_delivery_logs`; la supresión es client-side y **no** deja rastro en esa tabla.
- 🟠 **Security advisors (DB):** varias funciones `SECURITY DEFINER` (`admin_*`, `has_role`, `validate_invitation_code*`, `cleanup_old_logs`) son ejecutables por `anon`/`authenticated` vía RPC. Y "leaked password protection" está OFF en Auth. Heredados del clone. Revisar con Architect si amerita endurecer (revoke EXECUTE / SECURITY INVOKER).
- ✅ **`morning-matches` v3 deployado 2026-06-13** — fix del cross-match de municipios (bug 86aj165ed). La lógica de matching se extrajo de `index.ts` a `morning-matches/matching.ts` (pura, unit-testeada en `matching.test.ts`) y se portó el fix de stopwords de zona. Deploy: `supabase functions deploy morning-matches --project-ref osrphpndujdelfyetoah` (v2→v3, `verify_jwt` true). El build de Deno pasó limpio (valida lo que no se puede `deno check` en local).
- 🔁 **Runbook "commit ≠ deploy":** un commit/push **NO** deploya edge functions — Dokploy solo redeploya el front. Si un fix de edge function "no aparece en prod", correr `supabase functions deploy <slug> --project-ref osrphpndujdelfyetoah` y verificar con `supabase functions list` (o MCP `list_edge_functions`) que sube la `version`.
- ℹ️ **Rate-limiting del chat confirmado en prod (2026-06-13):** la migración `20260612130000_chat_rate_limiting` figura aplicada (`list_migrations`), así que `check_chat_rate_limit` existe y el gate **no es un no-op** (era un riesgo porque el gate es fail-open).

## Jobs programados (pg_cron) y scraper

Todo se dispara con **`pg_cron` + `pg_net`** desde la DB de Supabase (no hay cron externo). Estado en vivo: `select jobid, jobname, schedule, active from cron.job;`

| Job | Schedule (UTC) | Hora Córdoba | Qué hace |
|-----|----------------|--------------|----------|
| `nightly-scrape-properties` | `30 3 * * *` | **00:30** | `net.http_post` → Edge Function `scrape-properties` (body `{}` = modo orquestador) |
| `morning-property-matches` | `0 12 * * *` | 09:00 | `net.http_post` → `morning-matches` |
| `cleanup_old_logs_daily` | `0 6 * * *` | 03:00 | `cleanup_old_logs()` (limpia `scraping_logs` viejos) |

> El cron pasa un bearer con la **anon key** (visible en `cron.job.command`) — es la public key, no la service role; OK.

### `morning-matches` — scheduler verificado (spike [86aj18qz6], 2026-06-14)

**Qué lo dispara y cuándo:** el job pg_cron `morning-property-matches` (jobid 3, `active=true`), schedule `0 12 * * *` UTC = **09:00 Córdoba**, hace un `net.http_post` a la Edge Function `morning-matches`. **No hay disparador externo** (ni cron del VPS ni n8n) — todo es pg_cron + pg_net dentro de Supabase, igual que el scraper.

**Está corriendo:** `cron.job_run_details` muestra el job disparándose todos los días (06-11 a 06-14, status `succeeded`). La función generó matches a diario (`notified_matches`: 14-76/día; mensajes `proactive_match`: 8-35/día).

⚠️ **GOTCHA crítico — "succeeded" del cron ≠ la función terminó bien.** `pg_net` es asíncrono: el `net.http_post` solo **encola** el request, así que `cron.job_run_details.status='succeeded'` significa "se encoló el POST", **NO** "la edge function devolvió 200". Para la salud real hay que mirar los logs de la función (`get_logs` service `edge-function`) o el efecto downstream (`notified_matches` / mensajes `proactive_match` del día).

🔴 **Hallazgo del spike — la corrida del 2026-06-14 devolvió `546` (WORKER_LIMIT).** En los logs de edge la única invocación de `morning-matches` del día terminó en **status 546** (el worker fue terminado por la plataforma — casi seguro **timeout de wall-clock/CPU**, no el `catch` de la función, que devuelve 500). La función procesa **por usuario de forma incremental** (inserta `messages` + `notified_matches` a medida que avanza, sin transacción global), así que un 546 a mitad de camino deja una **corrida parcial**: ese día generó 25 notified / 6 msgs vs 76/35 del día previo. Causa probable: loops anidados sobre ~3.5k propiedades × clientes × users con muchos `await` secuenciales → satura el límite del worker a medida que crece el catálogo. Los usuarios no procesados **no pierden** sus matches (los toma la corrida del día siguiente vía dedup en `notified_matches`), pero **se notifican tarde** y el fallo es **invisible** (el cron dice "OK"). → Derivado a PM para bug aparte (optimizar/paginar `morning-matches` o moverlo a procesamiento por lotes). Nota: la función está hoy en **v5** (infra mencionaba v3 al 2026-06-13; se redeployó desde entonces).

✅ **Fix [86aj1pgvb] RESUELTO (2026-06-17, v10).** `morning-matches` ya no 546ea. Historia: el primer intento (v9, batching por usuario) **falló el smoke test** — un worker de 8 users 546eó a los ~3.4s. **Root cause real:** matching **O(props × clientes) por usuario**, con **máx 2407 clientes/usuario (prom 208)** → un solo usuario pesado revienta el CPU limit; batchear por usuario no alcanza.
> **Solución (v10):** se acotó el TRABAJO por invocación. El worker es **cursor-driven** (`{userIdx, phase: buyer|seller, offset}`): cada invocación procesa un **slice de `WORK_BUDGET=40000` pares** (`sliceSize` = budget / loop interno; buyer = props≤500 → ~80 clientes/slice; seller = budget / nº buyers) y se auto-encadena. El matching (`matching.ts`) quedó **intacto** → cero cambio en qué matchea. El **push se desacopló**: los workers solo escriben matches; al cerrar la corrida una **fase de push** (`sendRunPushes`) manda UN push por usuario reconstruyendo desde `notified_matches` de la ventana de la corrida (el `client_type` del cliente notificado distingue buyer/seller). Helpers puros (`batching.ts`: `sliceSize`, `nextCursor`, `computeRunStatus`, `isOrchestratorCall`) con tests.
> **Smoke test en prod OK (2026-06-17):** corrida completa **23/23 usuarios, 0 errores, 144 buyer + 22 seller match groups, 77s, status `success`** — sin un solo 546, incluyendo el usuario de 2407 clientes. El **seller→buyer matching revivido** produjo matches por primera vez (estaba muerto por bug de scope desde 2026-04-15).
> **Observabilidad:** tabla `match_runs` (RLS ON sin policies, solo service_role — patrón `error_logs`) con una fila por corrida (`running|success|partial|error` + contadores). Para chequear salud: `select status, users_processed, buyer_match_groups, seller_match_groups from match_runs order by started_at desc limit 1`.
> **Self-invoke:** usa la service key como Bearer; `morning-matches` sigue con `verify_jwt=true` (endpoint gateado, no abierto). El cron sigue disparando orchestrator con su bearer anon (body sin `batchTimestamp` → orchestrator).

📌 **Drift en el historial de migraciones (detectado 2026-06-17, pendiente de reconciliar):** `supabase migration list --linked` muestra desalineación de la sesión /devops del 2026-06-14 (aplicó vía MCP, que registra con timestamp fresco): los archivos locales `20260614120000_error_logs` y `20260614120100_health_monitor_cron` figuran **pendientes** pero su contenido **ya está aplicado** en remoto bajo las versiones `20260614212206` / `20260614212418` (orphans sin archivo local). `match_runs` se aplicó vía MCP también (2026-06-17), así que el archivo `20260617000000` queda igual de "phantom-pending". **No hacer `supabase db push` a ciegas** (re-correría el `cron.schedule` del health-monitor → cron duplicado). Reconciliar con `supabase migration repair --status applied <versión-archivo>` + `--status reverted <versión-orphan>` en una ventana tranquila.

### Scraper de propiedades — arquitectura (dos piezas)

1. **Scraper crudo (VPS/Dokploy):** `http://remaxdocta-scrapingdocta-…sslip.io/api/scrape`. Expone `?mode=checkMaxPages&operationId=N` y `?startPage&endPage&operationId`. Es el que pega contra la data de RE/MAX Docta. **Single point of failure**: si esta app del VPS se cae, el scraping falla aunque Supabase esté sano.
2. **Edge Function `scrape-properties` (Supabase):** orquesta. Modo orquestador (sin `operationId`) arranca la cadena; modo worker scrapea 20 páginas por invocación y **se auto-encadena** (`selfInvoke`) hasta cubrir las 3 operaciones (Venta, Alquiler, Alq. temporario). Upsert en `properties` (onConflict `external_id`) + `last_seen_at`; al final `runCleanup` borra las no vistas y notifica a OVERLORD vía el endpoint de Intake.

### Monitoreo del scraper

- **Tabla `scraping_logs`** (solo últimos 5 batches; el resto lo borra el cleanup). `batch_id` = timestamp ISO de la corrida. Health-check:
  ```sql
  select batch_id, count(*) filter (where level='error') as errores,
         bool_or(message like '%finalizado%' or level='success') as termino,
         min(created_at) inicio, max(created_at) fin
  from scraping_logs group by batch_id order by inicio desc;
  ```
- Récord al **2026-06-14**: corre diario sin fallar, **0 errores**, ~3.5k propiedades/corrida, ~20-25 min. La línea final `🏁 Scraping finalizado — N actualizadas, M eliminadas` (level `success`) marca cierre OK.

### Aviso a OVERLORD por corrida (ticket [86aj1n446], ✅ deployado, v6 — commit `a034d8b`, 2026-06-18)

> Nota de reconciliación (2026-06-18): el cambio de código (migración de `N8N_WEBHOOK_URL` → endpoint de Intake de OVERLORD) se había **deployado a prod (v5) sin commitear** en una sesión previa; quedó en el working tree. Se commiteó (`a034d8b`) y redeployó idéntico (v6) para alinear git ↔ prod. Código y doc ahora consistentes; `OVERLORD_TOKEN` confirmado seteado.

`runCleanup` notifica **siempre** al cerrar el batch, vía el **endpoint de Intake de OVERLORD** (`POST https://n8n.ignaciopoletti.dev/webhook/overlord-intake`, header `X-Overlord-Token: $OVERLORD_TOKEN`). Contrato canónico de `OVERLORD/INSTRUCTIONS.md` §7 (no inventar webhook propio). Rutea según un `status` calculado:

| status | condición | payload Intake | efecto en OVERLORD |
|--------|-----------|----------------|--------------------|
| `success` | `errorCount===0` | `type:"info"` | solo ping Telegram a Nacho (sin ticket) |
| `partial` | `upserted>0` pero `errorCount>0` (perdió páginas) | `type:"info"` con detalle | solo ping |
| `error` | `upserted===0` (VPS caído / todo falló) | `type:"error", severity:"high", ticket:true` | **ticket** en Backlog de doctabot + ping |

- **No duplica con el Monitor de OVERLORD:** el scraper devuelve 200 aun cuando falla (errores resilientes), así que el Monitor (que mira 5xx en logs) no lo ve. El reporte explícito acá es la única señal.
- **Caso "no corrió" (cron caído):** lo cubre el check `scraper_freshness` del `health-monitor` (alerta si `scraping_logs` no tiene fila nueva en ≤26h — ver sección Observabilidad). O sea el dead-man's-switch **ya existe**; no hace falta uno nuevo.
- Si `OVERLORD_TOKEN` no está seteado, `runCleanup` loguea un warning y omite el aviso (no rompe el batch).

## Monitoreo

- Logs de Edge Functions: Supabase Dashboard → Functions → Logs, o MCP `get_logs` (service `edge-function`).
- Calidad de Alan: tabla `supervisor_logs` (verdict/score/reason por turno — el supervisor post-hoc loguea cada turno). Ver [ADR-001](./adrs/0001-supervisor-post-hoc-streaming.md).

### Observabilidad — error tracking + uptime (ticket [86aj18r6x], 2026-06-14)

Enfoque **liviano sin SaaS externo** (decisión de Nacho): se reusa el canal n8n/Overlord que ya se mira, cero costo y cero bloat de bundle. No hay Sentry.

**Error tracking — tabla `public.error_logs`** (`source`, `context`, `message`, `stack`, `metadata`, `user_id`, `created_at`). RLS ON sin policies → solo `service_role` escribe/lee. Se consulta desde el dashboard o SQL:
```sql
select created_at, source, context, left(message,120) from error_logs order by created_at desc limit 50;
```
- **Edge functions:** helper `supabase/functions/_shared/observability.ts` → `reportEdgeErrorBg({context, error})` en el `catch`. Persiste en `error_logs` + ping a `N8N_WEBHOOK_URL` (`type: "edge_error"`). Fire-and-forget, nunca tira. Cableado en `chat`, `morning-matches`, `scrape-properties` (extensible al resto con una línea).
- **Frontend:** `src/lib/error-reporting.ts` (handlers globales `window.onerror` + `unhandledrejection`, con throttle/dedupe) + `src/components/ErrorBoundary.tsx` (errores de render de React). Postean a la Edge Function **`report-error`** (`verify_jwt=false`), que inserta en `error_logs` (`source='frontend'`) + ping n8n (`type: "frontend_error"`).

**Uptime — Edge Function `health-monitor` + pg_cron `health-monitor` (`*/10 * * * *`).** Cada 10 min corre checks y, si alguno falla, postea UNA alerta consolidada a `N8N_WEBHOOK_URL` (`type: "uptime_alert"`, con array `failing`). Checks: `frontend` (GET chat.doctabot.online <500), `chat` (OPTIONS <500), `error_spike` (≥10 errores en 15 min), `scraper_freshness` (última fila de `scraping_logs` ≤26h), `morning_matches` (después de 12:30 UTC: 0 matches del día con props nuevas = corrió mal — captura el fallo 546 del ticket 86aj18qz6). Probarlo a mano: `curl -X POST .../functions/v1/health-monitor` → devuelve `{ok, checks[]}`.
- **Tunables vía env (opcional):** `HEALTH_FRONT_URL` (default `https://chat.doctabot.online`), `HEALTH_ERROR_SPIKE` (default 10).
- ⚠️ **Limitación conocida:** el monitor corre dentro de Supabase, así que **no detecta "Supabase 100% caído"** (si la DB cae, el cron tampoco corre). Cubre los fallos app-level reales (front caído, chat roto, scraper/matches sin correr, spike de errores). Para cubrir el caso "Supabase down" haría falta un pinger externo (Better Stack/UptimeRobot free) — pendiente si se quiere ese nivel.

> Estado de deploy al 2026-06-14: **TODO DEPLOYADO.** `report-error` + `health-monitor` deployadas; migración `error_logs` + cron aplicados; `chat`/`morning-matches`/`scrape-properties` redeployadas con el error capture activo (chat verificado OPTIONS→200 post-deploy); front pusheado a `main` (commit `ce056a0`) → Dokploy auto-deploya los handlers + ErrorBoundary. Uptime monitoring EN VIVO (cron job 4).
