## Diagnóstico

Alan corre hoy con `gemini-2.5-flash` como modelo principal (ver `supabase/functions/chat/index.ts:82`). Flash es el modelo más liviano y barato de la familia Gemini 2.5: rápido, pero **flojo en razonamiento multi-step y en el uso proactivo de herramientas**. Eso explica los síntomas que reportan los agentes:

- Pide datos que ya tiene (teléfono, email del cliente) en vez de llamar primero a `get_client` / `list_clients`.
- Dice "no puedo extraer información" de PDFs/imágenes que sí entrarían en su capacidad.
- Insiste en negarse antes de finalmente ejecutar la herramienta correcta — clásico patrón de un modelo chico al que le cuesta planificar tool calls.

Las llamadas auxiliares (supervisor y generación de título) también usan Flash, pero esas son tareas simples (clasificar y resumir) donde Flash anda bien y conviene mantenerlo por costo/latencia.

## Solución

**1. Subir el modelo principal a `gemini-2.5-pro`**
- Endpoint: el mismo (OpenAI-compatible de Google), la misma `GEMINI_API_KEY`, **sin** cambios de infraestructura.
- Pro es marcadamente mejor en: razonamiento, function calling, multimodal (PDFs/imágenes), seguir instrucciones largas y proactivo en tool use.
- Costo: ~10× más caro por token que Flash, pero los volúmenes de Alan son bajos y el ROI en calidad/agentes contentos lo justifica con creces.

**2. Mantener Flash en utilidades**
- `supervisor.ts` y `title.ts` siguen con `gemini-2.5-flash`. Son llamadas chiquitas, frecuentes, y donde la calidad de Flash sobra.

**3. Reforzar dos reglas en el prompt** (cambio chico, complementa el upgrade)
- "Antes de pedir un dato del cliente (teléfono, email, etc.), SIEMPRE consultá primero con `get_client` o `list_clients`. Solo si la herramienta confirma que el dato no existe, recién ahí pedíselo al agente."
- "Si te adjuntan un PDF o imagen, intentá extraer la información primero. Solo decí 'no puedo extraer' si la herramienta de procesamiento devuelve error real."

### Cambios

**`supabase/functions/chat/index.ts` (línea 82)**
```ts
const PRIMARY_MODEL = "gemini-2.5-pro";
```

**`supabase/functions/chat/_shared/prompt.ts`** — agregar 2 bullets en la sección "REGLA CRÍTICA — USO OBLIGATORIO DE HERRAMIENTAS" (~línea 388).

**No tocar** `supervisor.ts` ni `title.ts`.

## Alternativas consideradas

- **`gemini-3-flash-preview` / `gemini-3.1-pro-preview`**: más nuevos pero en preview, menos estables para producción. Si Pro 2.5 no alcanza, podemos saltar después.
- **Lovable AI Gateway**: implicaría reescribir toda la integración (hoy va directo a Google) sin un beneficio claro inmediato. Se puede evaluar como migración aparte.

## Verificación

Después del cambio:
1. Probar en la app: enviar un PDF y pedir extracción → debe extraer sin quejarse.
2. Pedir "redactá un WhatsApp para [cliente que ya existe]" → debe llamar `get_client` directo, no pedir el número.
3. Revisar latencia (Pro es ~30-50% más lento que Flash; aceptable para los volúmenes actuales).
4. Monitorear costos a la semana en el dashboard de Google AI Studio.