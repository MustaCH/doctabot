

## Diagnóstico de notificaciones push

Encontré las dos causas raíz inspeccionando logs y base de datos:

### Problema 1 — En la app dice "notificaciones desactivadas" pero iOS las tiene activadas

Tu user_id (`8598898b…`) tiene **5 suscripciones obsoletas** en `push_subscriptions`, todas con endpoint de Apple (`web.push.apple.com/...`), creadas entre el 14 y el 15 de abril. Todas fallan con `VapidPkHashMismatch` — significa que se registraron con una clave VAPID anterior y el servidor de Apple las rechaza.

Cuando abrís Alan, el hook `usePushNotifications` mira si **el navegador actual** tiene una `pushManager.getSubscription()` activa. Si iOS borró la suscripción (lo hace silenciosamente cuando hay mismatch) o si estás en otro navegador/PWA, devuelve `null` y la UI muestra "desactivadas". El permiso de iOS sigue en "permitir" porque iOS no lo revoca, pero la suscripción real ya no existe.

### Problema 2 — No llega push cuando salís de la app

Misma raíz: tus 5 suscripciones devuelven 400 `VapidPkHashMismatch`, así que `send-push-notification` nunca entrega nada. Además el código actual **no borra** las suscripciones que fallan con 400 (solo borra con 410/404), así que se acumulan zombies para siempre.

---

### Plan de arreglo (1 fase, atómica)

**1. Limpieza de DB**
Borrar las 6 suscripciones existentes (5 tuyas + 1 del otro user). Ya están todas rotas — al volver a entrar a la app cada usuario re-suscribe limpio.

**2. Edge function `send-push-notification`**
- Tratar `400 VapidPkHashMismatch` (y cualquier 400 con `reason: VapidPk*` o `BadJwtToken`) igual que 410/404: borrar la suscripción de la DB. Esto evita zombies en el futuro si rotás VAPID otra vez.
- Loggear el endpoint truncado al borrar, para auditoría.

**3. Hook `use-push-notifications.ts` — UX más honesta**
- Si `Notification.permission === "granted"` pero `getSubscription()` devuelve `null`, **re-suscribir automáticamente** en vez de mostrar "desactivadas". Es el caso típico post-mismatch en iOS.
- Si la re-suscripción falla, ahí sí mostrar el switch en off con un mensaje "Tocá para reactivar".
- Agregar log claro (`console.warn`) cuando detecte permission=granted sin subscription, para diagnosticar a futuro.

**4. Edge function `chat` — push más confiable**
- Hoy solo manda push si la respuesta tarda >3s. Cambiarlo: mandar push **siempre que `document.hidden` haya sido true** — pero el server no sabe eso. Alternativa simple: mandar push siempre que la conversación tenga al menos 1 suscripción activa y `elapsed > 1500ms` (bajar de 3000 a 1500). Respuestas instantáneas (<1.5s) se asumen que el user está mirando.
- Verificar que el call a `sendPushNotification` no tenga `await` bloqueando — ya es fire-and-forget, OK.

**5. Verificación post-deploy**
Pedirte que:
- Entres a Alan en el iPhone, vayas a Perfil → veas si el switch de notificaciones aparece en off → al tocarlo se debería re-suscribir solo (el hook nuevo lo hace automático al cargar si detecta permiso granted).
- Le mandes un mensaje a Alan, salgas de la app, esperés ~5 segundos. Debería llegar la notificación.

### Detalles técnicos

Archivos a tocar:
- `supabase/functions/send-push-notification/index.ts` — manejo de 400 mismatch + delete
- `src/hooks/use-push-notifications.ts` — auto re-subscribe si permission=granted && !subscription
- `supabase/functions/chat/index.ts` — bajar umbral de 3000ms a 1500ms
- Migration SQL — `DELETE FROM push_subscriptions` (limpieza one-shot)

Sin cambios en `sw-push.js` ni en VAPID keys (las keys están bien, el problema son las subs viejas).

