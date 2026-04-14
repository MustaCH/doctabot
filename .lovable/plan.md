

## Fix: Error al reconectar con Alan al volver a la PWA

### Problema
Cuando el usuario minimiza la PWA mientras Alan procesa, el SO móvil corta la conexión de red del fetch stream. Al volver, el `reader.read()` falla con un error de red, que cae en el catch genérico mostrando "Error al conectar con Alan". Pero Alan ya puede haber terminado y guardado su respuesta en la DB.

### Solución

**Detectar que el error fue por desconexión (app en segundo plano) y recargar mensajes desde la DB en vez de mostrar error.**

#### 1. `src/hooks/use-chat-messages.ts` — Catch inteligente

En ambos catch blocks (texto y audio):
- Detectar si el error es de red (`TypeError` con message de network/fetch, o `AbortError` no intencional)
- Añadir un listener de `visibilitychange` que, al volver visible, recargue los mensajes desde la DB para esa conversación
- No mostrar toast de error si el documento estaba oculto cuando ocurrió el fallo
- Limpiar `isStreaming` correctamente

Lógica concreta:
```typescript
// En el catch:
const wasHidden = document.visibilityState === "hidden";
if (err.name === "AbortError" && !abortRef.current?.signal.aborted) {
  // Network killed by OS, not user-initiated abort
  // Reload messages from DB when app becomes visible
} else if (wasHidden || err.message?.includes("network") || err instanceof TypeError) {
  // App was backgrounded, network dropped
}
```

#### 2. `src/hooks/use-chat-messages.ts` — Auto-reload on visibility restore

Agregar un efecto que, cuando `isStreaming` es true y el documento vuelve a ser visible tras estar oculto, recargue los mensajes desde la DB:

```typescript
useEffect(() => {
  const handler = () => {
    if (document.visibilityState === "visible" && streamInterruptedRef.current && activeConvId) {
      // Reload messages from DB
      reloadMessagesFromDB(activeConvId);
      streamInterruptedRef.current = false;
    }
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}, [activeConvId]);
```

#### 3. Función de recarga desde DB

Extraer la lógica de carga de mensajes (ya existente en el useEffect de `activeConvId`) a una función reutilizable que se pueda llamar tanto al cambiar de conversación como al recuperarse de una interrupción.

### Archivos a modificar
- `src/hooks/use-chat-messages.ts`

### Resultado esperado
- Si Alan terminó mientras la app estaba en segundo plano → al volver se ve la respuesta completa sin error
- Si Alan no terminó (edge function también cortada) → al volver se ven los mensajes hasta donde llegaron, sin toast de error confuso

