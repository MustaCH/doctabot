

## Plan: Correcciones de Matching, Importación, Info Visible y Audio

### Problemas detectados

**1. Matching de propiedades incorrecto**
El algoritmo actual en `use-property-matches.ts` hace comparaciones substring (`includes`) entre property_type de la propiedad (ej: `terrenos_y_lotes`) y el `property_type_interest` del cliente (ej: `Departamento de 1 dormitorio`, `Casa o PH`, `Lote Docta Central`). Esto genera falsos positivos porque `"casa"` aparece dentro de `"casa_duplex"`, o `"lote"` matchea con `"terrenos_y_lotes"` cuando el cliente busca algo distinto. Además la zona se compara también por substring, causando matches imprecisos.

**2. Info de búsqueda del cliente no visible**
En el diálogo de "Clientes compatibles" (`PropertyMatchesDialog`) no se muestra qué busca cada cliente (zona, presupuesto, tipo). En la ficha del cliente (`ClientDetail`) la sección "Búsqueda" está dentro de un `<details>` colapsado por defecto, obligando a hacer click extra.

**3. Importación pone todos como "buyer"**
En `ImportClientsDialog.tsx` línea 170-173, el import fuerza `status: "hot"` pero no extrae `client_type` de las notas. La IA del parser (`parse-client-import`) solo mapea name/phone/email — no detecta el tipo de contacto. El campo "Tipo de Contacto: Vendedor" queda en las notas pero `client_type` siempre es el default de la DB (`buyer`).

**4. Audio no funciona en desktop ni mobile**
El transcribe function se ve correcta tras el fix anterior. Necesito verificar si hay errores actuales en los logs de la edge function `chat` relacionados con audio o transcripción. El problema podría estar en el frontend (recording flow) o en la transcripción misma.

---

### Cambios a implementar

#### Fix 1: Mejorar algoritmo de matching
**Archivo:** `src/hooks/use-property-matches.ts`

- Normalizar los tipos de propiedad antes de comparar: convertir `terrenos_y_lotes` → `terreno`, `lote`; `departamento_*` → `departamento`; `casa_*` → `casa`, etc.
- Tokenizar tanto el `property_type` de la propiedad como el `property_type_interest` del cliente en palabras clave, y matchear por tokens en vez de substring completo.
- Para zonas: comparar por igualdad exacta (case-insensitive, trimmed) en vez de `includes`, ya que las zonas son valores definidos (Nueva Córdoba, Centro, etc.).
- Solo matchear clientes de tipo `buyer` o `both` (los vendedores no buscan comprar).

#### Fix 2: Mostrar info de búsqueda del cliente
**Archivo:** `src/components/PropertyMatchesDialog.tsx`

- Agregar debajo de cada cliente su zona preferida, presupuesto y tipo de propiedad buscada en formato compacto (como badges o línea de texto).

**Archivo:** `src/pages/ClientDetail.tsx`

- Cambiar el `<details>` de "Información del cliente" a que esté abierto por defecto (`open` attribute), o mover la sección "Búsqueda" fuera del collapsible para que siempre sea visible.

#### Fix 3: Detectar client_type en importación
**Archivo:** `supabase/functions/parse-client-import/index.ts`

- Agregar al prompt de la IA la instrucción de detectar una columna o valor que indique si es "Vendedor" o "Comprador", mapeándolo a un nuevo campo `client_type_column` en la herramienta `map_columns`.

**Archivo:** `src/components/ImportClientsDialog.tsx`

- En `applyMapping`, extraer el `client_type` del mapping de la IA.
- Como fallback: si en las notas aparece "Tipo de Contacto: Vendedor", setear `client_type: "seller"`.
- Mostrar en la preview una columna "Tipo" para que el usuario valide antes de importar.

#### Fix 4: Diagnóstico y fix de audio
**Acción:** Revisar logs recientes de la edge function `transcribe` y `chat` para errores específicos. Verificar el flujo completo:
- El `sendRecording` en `ChatInput.tsx` envía correctamente el blob
- `transcribeAudio` en `use-audio-recorder.ts` envía el FormData al endpoint
- El formato del audio (`webm`/`mp4`) es soportado por Gemini

Posible issue: en `transcribe/index.ts` línea 40, el formato se mapea a `webm`/`mp3`/`wav` pero no contempla `mp4` ni `ogg` para el campo `format` de Gemini. Si Safari graba en `mp4`, el formato se envía como `wav` (fallback incorrecto).

**Fix:** Corregir el mapeo de formato en `transcribe/index.ts` para incluir `mp4` y `ogg`. Agregar mejor error handling en el frontend para mostrar mensajes descriptivos al usuario.

---

### Resumen de archivos

| Archivo | Cambio |
|---|---|
| `src/hooks/use-property-matches.ts` | Mejorar algoritmo de matching con normalización de tipos y zonas |
| `src/components/PropertyMatchesDialog.tsx` | Mostrar zona, presupuesto y tipo que busca cada cliente |
| `src/pages/ClientDetail.tsx` | Sección "Búsqueda" visible por defecto |
| `supabase/functions/parse-client-import/index.ts` | Detectar tipo de contacto (vendedor/comprador) |
| `src/components/ImportClientsDialog.tsx` | Extraer client_type, fallback por notas, columna en preview |
| `supabase/functions/transcribe/index.ts` | Corregir mapeo de formato audio (mp4, ogg) |

