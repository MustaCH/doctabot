

## Plan: Botón "Enviar por WhatsApp" en borradores del chat

### Enfoque

Agregar marcadores especiales para que cuando Alan redacte un mensaje de WhatsApp y conozca el teléfono del cliente, el borrador muestre un botón "Enviar por WhatsApp" que abre `wa.me` con el mensaje pre-cargado.

### Cambios

**1. `supabase/functions/chat/index.ts` — System prompt**

Agregar instrucción para que cuando Alan redacte un borrador de WhatsApp y tenga el teléfono del cliente, use un marcador especial:

```
<<<WHATSAPP_TO:+5493511234567>>>
<<<DRAFT_START>>>
Hola, soy Agente de RE/MAX Docta...
<<<DRAFT_END>>>
```

- Si no tiene teléfono, usa `<<<DRAFT_START>>>` normal (solo "Copiar")
- Si tiene teléfono, agrega `<<<WHATSAPP_TO:número>>>` antes del draft

**2. `src/components/ChatMessage.tsx` — Detección y botón**

- Actualizar `extractDraftBlock()` para detectar `<<<WHATSAPP_TO:...>>>` y extraer el número
- Crear componente `WhatsAppDraft` que muestre el borrador con:
  - Botón verde "Enviar por WhatsApp" (ícono de WhatsApp) que abre `https://wa.me/{número}/?text={urlencodedtext}`
  - Botón secundario "Copiar" (como fallback)
- Si no hay marcador `WHATSAPP_TO`, sigue mostrando `CopyableDraft` como hasta ahora

### Archivos

| Archivo | Cambio |
|---|---|
| `supabase/functions/chat/index.ts` | Agregar instrucciones de `<<<WHATSAPP_TO:número>>>` al system prompt |
| `src/components/ChatMessage.tsx` | Detectar marcador WhatsApp, renderizar botón con link `wa.me` |

