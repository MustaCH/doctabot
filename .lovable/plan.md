
## Botón X siempre visible en mobile + Indicador "Procesando PDF..."

### 1. Botón X visible en mobile

**Archivo:** `src/components/ChatInput.tsx` (linea 106)

Cambiar la clase del boton de eliminar adjunto para que sea visible siempre en mobile y solo con hover en desktop:

```
// Antes:
"opacity-0 group-hover:opacity-100 transition-opacity"

// Después:
"opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
```

Esto hace que en pantallas menores a `md` (768px) el boton siempre sea visible, y en desktop mantenga el comportamiento hover actual.

### 2. Indicador "Procesando PDF..."

**Archivo:** `src/pages/Chat.tsx`

- Agregar un estado `isProcessingPdf` (boolean, default false)
- Activarlo (`true`) antes del bucle de extraccion de texto PDF (linea ~208)
- Desactivarlo (`false`) despues de que termine la extraccion
- Renderizar un indicador visual encima del input cuando `isProcessingPdf` es true: un pequeno banner con un spinner y el texto "Procesando PDF..." con animacion de aparicion
- Deshabilitar el boton de envio mientras se procesa (pasando `disabled={isStreaming || isProcessingPdf}` al ChatInput)

El indicador se mostrara como una barra sutil entre el area de mensajes y el input, con un icono de carga animado y texto descriptivo.

### Resumen de cambios

| Archivo | Cambio |
|---|---|
| `src/components/ChatInput.tsx` | Cambiar clases del boton X para visibilidad mobile |
| `src/pages/Chat.tsx` | Agregar estado y UI de "Procesando PDF..." |
