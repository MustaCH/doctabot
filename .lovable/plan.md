
# Integración Google Meet + Gmail en Alan

## Contexto actual

Alan ya tiene control total sobre Google Calendar del agente (crear, listar, actualizar, eliminar eventos). La conexión OAuth está en `supabase/functions/google-calendar-auth/index.ts` y los tokens se guardan en la tabla `google_calendar_tokens`.

El scope actual es solo: `https://www.googleapis.com/auth/calendar`

---

## Qué se va a construir

### 1. Nuevos scopes de Google OAuth

La primera vez que el agente conecte (o al reconectar), se pedirán los tres scopes necesarios:

```text
https://www.googleapis.com/auth/calendar         (ya existe)
https://www.googleapis.com/auth/meet.readonly     (para crear conferencias via Calendar)
https://www.googleapis.com/auth/gmail.send        (para enviar emails)
```

**Nota importante sobre Google Meet**: La API de Google Meet no requiere un scope separado para crear *conference links* dentro de un evento de Calendar. Se agrega el campo `conferenceData` al crear/actualizar el evento con `conferenceDataVersion=1`. El link de Meet aparece automáticamente. Solo se necesita `gmail.send` como scope adicional.

Para Gmail, el scope `gmail.send` es el de menor privilegio — solo permite enviar, nunca leer el buzón del usuario.

---

### 2. Actualización del flujo OAuth (`google-calendar-auth/index.ts`)

- Ampliar el string `scope` en el paso "init" para incluir `gmail.send`
- El resto del flujo (intercambio de código, guardado de token, refresh) funciona igual

---

### 3. Nuevas herramientas para Alan (`chat/index.ts`)

**`create_meet_event`** — Crea un evento en Calendar con enlace de Google Meet incluido:
- Parámetros: `summary`, `start_datetime`, `end_datetime`, `description`, `attendees` (lista de emails, opcional)
- Internamente: llama a Calendar API con `conferenceData: { createRequest: { requestId: ... } }` y `conferenceDataVersion=1`
- Devuelve: `event_id`, `meet_link`, `html_link`, `start`, `end`

**`send_email`** — Envía un email desde la cuenta Gmail del agente:
- Parámetros: `to` (email del destinatario), `subject`, `body` (texto plano o HTML), `cc` (opcional)
- Internamente: construye un mensaje MIME en base64url y lo envía via `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`
- **NUNCA se envía sin confirmación previa del agente** — esto se maneja en el prompt del sistema
- Devuelve: `message_id`, confirmación de envío

---

### 4. Actualización de `create_calendar_event`

Se agrega un parámetro opcional `add_meet_link: boolean`. Si es `true`, se añade `conferenceData` al evento (esto permite que Alan cree un Meet desde la misma herramienta de Calendar cuando el agente lo pide sin necesidad de una herramienta separada).

---

### 5. Prompt del sistema — nuevas instrucciones

Se agrega una sección `## GOOGLE MEET Y GMAIL` con las reglas:

**Google Meet:**
- Si el agente dice "reunión por Meet", "videollamada", "llamada de Google" → usar `create_meet_event`
- Al crear el evento, mostrar el link de Meet de forma clara al agente para que lo comparta
- Si Alan ya creó un evento con Meet y el agente quiere enviar el link por email → usar `send_email` con previa confirmación

**Gmail:**
- Alan NUNCA envía un email sin mostrar primero el borrador y recibir confirmación explícita del agente (ej: "envialo" o "sí, mandalo")
- El flujo es: 1) Redactar borrador en formato `<<<DRAFT_START>>>` habitual → 2) Preguntar "¿Lo envío?" → 3) Si el agente confirma, ejecutar `send_email`
- Si el calendario no está conectado con los nuevos permisos, indicar que debe reconectar desde el perfil

---

### 6. UI — Indicador de permisos insuficientes

En `src/pages/Profile.tsx`, si el token existente no tiene el scope `gmail.send` (detectable porque el campo `scope` guardado en `google_calendar_tokens` no lo incluye), mostrar un badge/aviso de "Permisos insuficientes — Reconectá para activar Gmail y Meet" con un botón que inicia el flujo OAuth de nuevo.

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `supabase/functions/google-calendar-auth/index.ts` | Agregar `gmail.send` al scope |
| `supabase/functions/chat/index.ts` | Agregar tools `create_meet_event` y `send_email`, actualizar `create_calendar_event` con `add_meet_link`, actualizar prompt del sistema |
| `src/pages/Profile.tsx` | Detectar scope insuficiente y mostrar aviso de reconexión |

---

## Seguridad

- `send_email` usa el access token del agente obtenido desde `google_calendar_tokens` — nunca un token genérico
- El scope `gmail.send` es el de menor privilegio posible para Gmail: no permite leer, listar ni acceder al buzón
- Todas las validaciones de `userId` ya existentes aplican igual a las nuevas herramientas
- El prompt obliga confirmación antes de enviar cualquier email — es una barrera soft pero efectiva
- El scope del token guardado se verifica en el perfil para detectar tokens que necesitan actualización

---

## Flujo completo de ejemplo

```text
Agente: "Agendá un Meet con María González para el lunes 24 a las 11am"

Alan: [ejecuta create_meet_event]
→ "Reunión creada ✅
   📅 Lunes 24 de febrero, 11:00 - 12:00
   🔗 Meet: https://meet.google.com/xxx-yyy-zzz
   ¿Querés que le mande el link por email a María?"

Agente: "Sí, mandáselo a maria@gmail.com"

Alan: [redacta borrador con DRAFT_START/DRAFT_END, incluye el link de Meet]
→ "Te preparé este email:
   <<<DRAFT_START>>>
   Hola María, ...
   Podés unirte desde: https://meet.google.com/xxx-yyy-zzz
   ¡Saludos! Juan Pérez
   <<<DRAFT_END>>>
   ¿Lo envío?"

Agente: "Sí"

Alan: [ejecuta send_email]
→ "Email enviado a maria@gmail.com ✉️"
```

---

## Nota sobre la verificación de Google

Agregar `gmail.send` es un scope **sensible** según Google. Esto implica que antes de que usuarios externos puedan usarlo, Google requiere verificación de la app (el proceso que ya estás iniciando). Durante el proceso de verificación, el agente podrá seguir usándolo en modo de prueba (máximo 100 usuarios de prueba configurados en Google Cloud Console).
