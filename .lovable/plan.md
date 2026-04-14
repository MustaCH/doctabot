## Plan: Notificaciones push + Alan proactivo con matching matutino

Este es un proyecto grande con 3 fases diferenciadas. Propongo implementarlo de forma incremental.

---

### Fase 1: Web Push Notifications (VAPID + Service Worker)

**1.1. Generar claves VAPID**

- Generar un par de claves VAPID (pública/privada) usando `web-push`
- Guardar `VAPID_PRIVATE_KEY` y `VAPID_PUBLIC_KEY` como secrets del proyecto
- La clave pública también se expone como variable de entorno `VITE_VAPID_PUBLIC_KEY` en el código frontend

**1.2. Tabla `push_subscriptions**`

- Crear tabla con: `id`, `user_id`, `endpoint`, `p256dh`, `auth`, `created_at`
- RLS: cada usuario solo ve/crea/elimina sus propias subscripciones

**1.3. Edge function `send-push-notification**`

- Recibe `user_id`, `title`, `body`, `url` (opcional)
- Busca todas las subscripciones del usuario con service role key
- Envía la notificación usando el protocolo Web Push (RFC 8030) con las claves VAPID
- Elimina subscripciones inválidas (410 Gone)

**1.4. Service Worker — manejo de push**

- Agregar un archivo `public/sw-push.js` con listener `push` y `notificationclick`
- En `notificationclick`, abre la URL de la conversación o la app
- Integrar el registro de este SW junto al de VitePWA existente

**1.5. Frontend — botón en Perfil + registro**

- Agregar debajo de la sección de Google en `Profile.tsx` un toggle "Notificaciones"
- Al activar: pedir permiso al navegador → `pushManager.subscribe()` → guardar en `push_subscriptions`
- Al desactivar: `pushManager.unsubscribe()` → eliminar de la tabla
- Mostrar estado actual (activado/desactivado)

---

### Fase 2: Chat en segundo plano (notificar cuando Alan responde)

**Cambio en `supabase/functions/chat/index.ts`:**

- Al final del procesamiento (después de guardar la respuesta del asistente), invocar `send-push-notification` con título "Alan respondió" y link a la conversación
- Solo enviar si la respuesta tardó más de 3 segundos (para no notificar respuestas instantáneas)
- Sólo enviar si el usuario no está dentro de ese chat al momento de aparecer la respuesta

**Cambio en frontend (`use-chat-messages.ts`):**

- Actualmente el streaming se corta si el usuario navega fuera del chat
- Mover la lógica de streaming/guardado para que la edge function maneje la persistencia completa (ya lo hace — el edge function guarda los mensajes vía `onDone`)
- El problema real es que el `fetch` se cancela al desmontar el componente. Solución: no cancelar el abort controller al desmontar, dejar que el stream termine en background

---

### Fase 3: Matching matutino proactivo (cron job diario a las 9am)

**3.1. Edge function `daily-property-alerts**`

- Obtiene todos los usuarios que tienen push habilitado
- Para cada usuario, ejecuta la lógica de matching (reutilizando el algoritmo de `use-property-matches.ts` pero en backend):
  - Busca propiedades creadas en las últimas 24h
  - Cruza con clientes del usuario (zonas, tipo, presupuesto)
- Si hay matches:
  - Busca la última conversación asignada al cliente (`conversations.client_id`)
  - Si existe, inserta un mensaje de Alan en esa conversación
  - Si no, crea una nueva conversación asignada al cliente
  - Envía push notification al usuario

**3.2. Cron job con pg_cron**

- Programar ejecución diaria a las 9:00 AM Argentina (12:00 UTC) usando `pg_cron` + `pg_net`
- Llama a la edge function `daily-property-alerts`

---

### Archivos a crear/modificar


| Archivo                                              | Cambio                                        |
| ---------------------------------------------------- | --------------------------------------------- |
| `public/sw-push.js`                                  | Nuevo — listener de push y notificationclick  |
| `src/hooks/use-push-notifications.ts`                | Nuevo — hook para registrar/desregistrar push |
| `src/pages/Profile.tsx`                              | Agregar toggle de notificaciones              |
| `src/main.tsx`                                       | Registrar `sw-push.js`                        |
| `supabase/functions/send-push-notification/index.ts` | Nuevo — enviar web push                       |
| `supabase/functions/chat/index.ts`                   | Invocar push al terminar respuesta            |
| `supabase/functions/daily-property-alerts/index.ts`  | Nuevo — matching matutino + notificación      |
| `src/hooks/use-chat-messages.ts`                     | No cancelar abort al desmontar                |
| Migración SQL                                        | Tabla `push_subscriptions` + pg_cron job      |


### Orden de implementación sugerido

1. Fase 1 completa (push notifications funcionales)
2. Fase 2 (notificación cuando Alan responde en background)
3. Fase 3 (cron job de matching matutino)

¿Aprobás para comenzar con la Fase 1?