

## Soporte para múltiples borradores en un mismo mensaje

### Problema
`extractDraftBlock` usa `indexOf` para encontrar el **primer** par `<<<DRAFT_START>>>...<<<DRAFT_END>>>`. Todo lo que queda después del primer `<<<DRAFT_END>>>` se mete en `outro` y se renderiza como markdown plano, incluyendo los marcadores crudos de los siguientes borradores.

### Solución
Reemplazar `extractDraftBlock` con `extractMultipleDraftBlocks` que devuelva un array de segmentos (texto intercalado + borradores), y actualizar `AssistantContent` para renderizarlos todos.

### Cambios en `src/components/ChatMessage.tsx`

**1. Nueva función `extractMultipleDraftBlocks`:**
```typescript
function extractMultipleDraftBlocks(content: string): { type: "text" | "draft"; text?: string; draft?: string; whatsappNumber?: string }[] | null {
  if (!content.includes(DRAFT_START)) return null;
  
  const segments: { type: "text" | "draft"; text?: string; draft?: string; whatsappNumber?: string }[] = [];
  let remaining = content;
  
  while (remaining.length > 0) {
    const startIdx = remaining.indexOf(DRAFT_START);
    if (startIdx === -1) {
      // No more drafts — rest is text
      if (remaining.trim()) segments.push({ type: "text", text: remaining.trim() });
      break;
    }
    
    // Text before this draft
    let beforeDraft = remaining.slice(0, startIdx).trim();
    const endIdx = remaining.indexOf(DRAFT_END, startIdx);
    if (endIdx === -1) {
      // Malformed — treat rest as text
      if (remaining.trim()) segments.push({ type: "text", text: remaining.trim() });
      break;
    }
    
    // Extract WhatsApp number from intro text
    let whatsappNumber: string | undefined;
    const waMatch = beforeDraft.match(WHATSAPP_TO_RE);
    if (waMatch) {
      whatsappNumber = waMatch[1];
      beforeDraft = beforeDraft.replace(WHATSAPP_TO_RE, "").trim();
    }
    
    if (beforeDraft) segments.push({ type: "text", text: beforeDraft });
    
    const draft = remaining.slice(startIdx + DRAFT_START.length, endIdx).trim();
    if (draft.length >= 20) {
      segments.push({ type: "draft", draft, whatsappNumber });
    }
    
    remaining = remaining.slice(endIdx + DRAFT_END.length);
  }
  
  return segments.length > 0 ? segments : null;
}
```

**2. Actualizar `AssistantContent`:**
- Reemplazar `draftBlock` con `draftBlocks` usando la nueva función
- Renderizar iterando sobre los segmentos: texto como markdown, drafts como `CopyableDraft`

### Archivo a modificar
- `src/components/ChatMessage.tsx`

