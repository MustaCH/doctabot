<final-text>
## Hallazgos
Identifiqué 4 causas probables del problema:

1. **Las push están fallando en backend**
   - Hay errores reales de entrega: `VapidPkHashMismatch`.
   - Eso significa que las suscripciones guardadas y la clave VAPID usada para enviar notificaciones **no están alineadas**.
   - Mientras eso siga así, **la notificación no va a llegar**.

2. **Existe una ruta de respuesta que no persiste el mensaje**
   - En `supabase/functions/chat/index.ts` hay un fallback final que hace:
   - `return new Response(streamResponse.body...)`
   - Esa ruta **streamea directo desde la IA** y **saltea** la persistencia del mensaje, la actualización de la conversación y la notificación.
   - Si Alan cae en esa ruta y el usuario sale de la app, el mensaje puede quedar **vacío, parcial o directamente perderse**.

3. **El deep link de la notificación apunta a una ruta incorrecta**
   - Hoy se envía `url: /chat?c=...`
   - Pero la app usa `"/"` como pantalla de chat, no `"/chat"`.
   - Incluso si la push empezara a llegar, el click no abriría correctamente la conversación.

4. **La recuperación del chat al volver no es lo bastante robusta**
   - `use-chat-messages.ts` solo recarga ante ciertos errores de red.
   - Además, al rehidratar mensajes desde DB sigue separando por `---`, mientras el protocolo actual usa `===MSG_BREAK===`.
   - Eso puede causar recuperación incompleta o render inconsistente.

## Plan
### 1) Blindar la generación para que siempre haya persistencia
Modificar `supabase/functions/chat/index.ts` para que **toda** respuesta de Alan termine en el mismo flujo:
- obtener contenido final
- guardarlo en base de datos
- actualizar `updated_at`
- disparar notificación si corresponde
- recién después devolverlo al cliente

Puntualmente:
- eliminar o reemplazar la ruta fallback que hoy transmite directo sin persistir
- si el primer intento no devuelve `finalContent`, hacer una generación alternativa **cerrada** en backend hasta obtener texto final
- si aun así no hubiera contenido, registrar el error y devolver una salida controlada, pero **nunca** dejar una respuesta “en el aire”

### 2) Corregir el sistema de notificaciones push
Actualizar el flujo de push para que cliente y backend usen la **misma identidad VAPID**:
- alinear la clave pública usada en `src/hooks/use-push-notifications.ts` con la del backend
- validar que el par de claves del backend sea consistente
- limpiar o invalidar suscripciones viejas que quedaron asociadas a otra clave
- forzar o automatizar la re-suscripción del dispositivo cuando detectemos desalineación

Esto resuelve el `VapidPkHashMismatch`.

### 3) Arreglar la apertura de conversación desde notificación
Cambiar el link push a algo compatible con la app actual, por ejemplo:
- `/?c=<conversationId>`

Y luego:
- leer ese parámetro al abrir el chat
- activar esa conversación automáticamente
- limpiar el parámetro una vez aplicado para no dejarlo persistido en la URL

### 4) Hacer más robusta la recuperación al volver a la app
Reforzar `src/hooks/use-chat-messages.ts` para que, cuando el usuario vuelva al foreground:
- recargue mensajes si había una respuesta en curso, aunque no haya habido error visible
- refresque también la lista de conversaciones
- use el separador actual `===MSG_BREAK===` al reconstruir mensajes guardados

Así, si Alan terminó mientras la app estaba minimizada, al volver se verá la respuesta real guardada en base de datos.

### 5) Verificación end-to-end
Probar estos escenarios después de implementar:
- salir y volver rápido mientras Alan sigue escribiendo
- salir y esperar a que termine
- recibir notificación con la app minimizada
- tocar la notificación y abrir la conversación correcta
- confirmar que el mensaje ya está guardado aunque el stream se haya cortado

## Archivos a tocar
- `supabase/functions/chat/index.ts`
- `supabase/functions/send-push-notification/index.ts`
- `src/hooks/use-push-notifications.ts`
- `src/hooks/use-chat-messages.ts`
- `src/pages/Chat.tsx` o `src/hooks/use-conversations.ts` para leer `?c=...`

## Resultado esperado
- Alan no vuelve a “perder” respuestas al salir de la app
- la conversación no aparece vacía al regresar
- no quedan mensajes parciales tipo `"!"`
- la notificación llega cuando corresponde
- al tocarla, abre la conversación correcta

## Detalles técnicos
- El problema principal no parece ser solo de UI: hay una combinación de **push rota + fallback sin persistencia**.
- La evidencia más fuerte es:
  - logs con `VapidPkHashMismatch`
  - fallback en `chat/index.ts` que devuelve `streamResponse.body` sin guardar
  - URL push apuntando a `/chat?c=...` aunque esa ruta no existe
  - rehidratación local usando un separador viejo distinto al protocolo actual
</final-text>