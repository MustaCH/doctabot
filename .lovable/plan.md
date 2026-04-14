
Objetivo

Corregir el badge de no leídos para que nunca se muestre sobre la conversación que está abierta en ese momento.

Diagnóstico

El problema no está en el render del badge sino en el orden de actualización:
- `markAsRead(activeConvId)` hoy corre cuando cambia `messages`, incluso durante el streaming.
- Cuando Alan termina, `use-chat-messages` guarda el mensaje final del asistente y luego ejecuta `loadConversations()`.
- Ese refresh vuelve a calcular `has_unread` usando un `latest_assistant_at` más nuevo que el `last_read_at` previo, así que el punto rojo reaparece hasta salir y volver a entrar.

Además, revisando el estado actual del backend, hay conversaciones donde el último mensaje del asistente quedó posterior a `last_read_at`, lo que confirma esa carrera.

Plan de implementación

1. Cambiar cuándo se marca una conversación como leída
- En `src/pages/Chat.tsx`, dejar el `useEffect` de `markAsRead` sólo para cuando cambia `activeConvId`.
- Quitar la dependencia de `messages` para evitar escrituras repetidas durante cada delta del streaming.

2. Marcar como leída después de persistir la respuesta final de Alan
- En `src/hooks/use-chat-messages.ts`, pasar `markAsRead` al hook (o un callback equivalente).
- En los dos flujos (`handleSend` y `handleSendAudio`), dentro de `onDone`, después de:
  - insertar el mensaje del asistente en `messages`
  - actualizar `conversations.updated_at`
  ejecutar `markAsRead(convId)` si esa conversación sigue siendo la activa.
- Recién después llamar `loadConversations()` para que el cálculo de no leídos use un `last_read_at` ya actualizado.

3. Agregar un blindaje visual para evitar estados transitorios
- En `src/hooks/use-conversations.ts`, al construir `has_unread`, forzar `false` para la conversación activa (`c.id === activeConvId`).
- Esto evita que, aunque haya una recarga desfasada, la UI no pinte un badge sobre el chat que el usuario está viendo.

Validación esperada

- Estando dentro de una conversación, Alan responde: no debe aparecer badge en esa conversación ni en el icono del menú.
- Si otra conversación sí tiene mensajes pendientes, su badge debe seguir mostrándose.
- Al cambiar de conversación y volver, el estado debe mantenerse correcto.
- El arreglo debe cubrir tanto mensajes normales como respuestas a audios.

Detalles técnicos

- No requiere cambios de base de datos.
- El bug es una condición de carrera entre `markAsRead()` y `loadConversations()`.
- El ajuste también mejora performance porque evita actualizar `last_read_at` en cada cambio incremental del streaming.

Archivos a modificar

- `src/pages/Chat.tsx`
- `src/hooks/use-chat-messages.ts`
- `src/hooks/use-conversations.ts`
