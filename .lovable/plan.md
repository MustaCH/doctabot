
## Botón de copiar en respuestas de Alan + Botón flotante de scroll

### 1. Botón "Copiar" en burbujas de Alan

Se agrega un botón discreto debajo de cada burbuja de respuesta del asistente que copia el texto plano al portapapeles.

- Aparece al hacer hover en desktop; siempre visible en mobile
- Usa el icono `Copy` de lucide-react, cambia a `Check` por 2 segundos tras copiar
- Usa `navigator.clipboard.writeText(content)` para copiar solo el texto sin formato
- Se posiciona debajo de la burbuja, alineado a la izquierda con un tamano pequeno (`text-xs`)

**Archivo:** `src/components/ChatMessage.tsx`
- Importar `Copy`, `Check` de lucide-react y `useState`
- En el componente `ChatMessage`, cuando `role === "assistant"`, renderizar debajo de la burbuja un boton con el icono y el texto "Copiar"
- Al hacer click, copiar `content` y cambiar el estado a "copiado" por 2 segundos

### 2. Botón flotante "Scroll to bottom"

Se agrega un boton circular flotante que aparece cuando el usuario scrollea hacia arriba y hay contenido nuevo abajo.

**Archivo:** `src/pages/Chat.tsx`
- Agregar un estado `showScrollBtn` (boolean, default false)
- Escuchar el evento `scroll` en `scrollRef.current`:
  - Si la distancia al fondo (`scrollHeight - scrollTop - clientHeight`) es mayor a 100px, mostrar el boton
  - Si no, ocultarlo
- Renderizar un boton circular fijo sobre el area de mensajes (bottom-right, encima del input) con el icono `ChevronDown`
- Al hacer click, scrollear suavemente al fondo con `scrollTo({ top: scrollHeight, behavior: "smooth" })`
- Animacion de entrada/salida con `transition-opacity` y `scale`

### Resumen de cambios

| Archivo | Cambio |
|---|---|
| `src/components/ChatMessage.tsx` | Agregar boton copiar debajo de burbujas del asistente |
| `src/pages/Chat.tsx` | Agregar estado y logica de scroll + boton flotante |

No se requieren cambios de base de datos ni edge functions.
