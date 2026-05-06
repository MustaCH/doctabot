
# Adaptación al nuevo schema del scraper Remax

## Resumen

El scraper externo fue actualizado con campos nuevos, tipos cambiados (strings → numbers), zona estructurada, soporte multi-operación, y datos de contacto. Hay que adaptar: base de datos, edge function de scraping, lógica de búsqueda de Alan, y la UI de propiedades.

---

## Fase 1: Base de datos — migración

Agregar columnas nuevas a la tabla `properties`:

| Columna nueva | Tipo | Descripción |
|---|---|---|
| `remax_id` | integer | ID numérico estable de Remax |
| `entity_id` | text | UUID de Remax |
| `operation_id` | integer | 1=Venta, 2=Alquiler, 3=Temp |
| `property_type_id` | integer | ID estable del tipo |
| `listing_status` | text | active/inactive |
| `is_entrepreneurship` | boolean default false | |
| `price_exposure` | boolean default true | Si false, ocultar precio |
| `expenses_price` | numeric | Expensas |
| `expenses_currency` | text | Moneda expensas |
| `habitaciones` | integer | Dormitorios (distinto de ambientes) |
| `contact_phone` | text | Teléfono agente |
| `contact_email` | text | Email agente |
| `office_id` | text | UUID oficina |
| `associate_id` | text | UUID agente |
| `zone_data` | jsonb | Zona estructurada completa |
| `zone_neighborhood` | text | Barrio (indexado para filtro) |
| `zone_city` | text | Ciudad (indexado para filtro) |
| `zone_county` | text | Departamento |
| `zone_private_community` | text | Barrio cerrado |
| `entrepreneurship` | jsonb | Datos emprendimiento |
| `photos` | text[] | Array completo de fotos |

Renombrar para consistencia (o mantener los existentes y mapear en el scraper — preferible para no romper RPCs):
- Mantener `dimensions_land_m2`, `m2_total`, `m2_cover` como están (el scraper ya parsea a number).

Actualizar la función RPC `search_properties_filtered` para incluir los campos nuevos en el resultado y opcionalmente filtrar por `zone_neighborhood`/`zone_city`.

## Fase 2: Scraper edge function

Actualizar `scrape-properties/index.ts`:

1. **Soporte multi-operación**: El scraper hará 3 pasadas (operationId 1, 2, 3) o recibirá el parámetro para hacer una sola.
2. **Nuevo `buildRecord`**: Mapear todos los campos nuevos del schema (`zone_neighborhood` extraído de `zone.neighborhood`, etc.).
3. **Cambiar `external_id`**: Usar el `id` numérico o `entityId` del nuevo schema como identificador estable.
4. **Mapear dimensiones**: `dimensionLand` → `dimensions_land_m2`, `dimensionTotalBuilt` → `m2_total`, `dimensionCovered` → `m2_cover`.
5. **Zona**: Guardar `zone_data` como JSONB completo, y extraer `zone_neighborhood`, `zone_city`, `zone_county`, `zone_private_community` a columnas indexadas. La columna `zone` existente se puede seguir usando con la lógica GeoJSON como fallback si `zone.neighborhood` es null.

## Fase 3: Alan (tools del chat)

1. **`search_properties` tool definition**: Agregar parámetros `neighborhood`, `city`, `habitaciones_min/max`, `is_entrepreneurship`.
2. **Executor**: Agregar filtros por `zone_neighborhood`, `zone_city`, `habitaciones`. Incluir `contact_phone`, `contact_email`, `price_exposure`, `expenses_price` en los resultados.
3. **Prompt**: Actualizar para que Alan conozca la distinción habitaciones vs ambientes, sepa de expensas, `priceExposure`, emprendimientos.

## Fase 4: UI — Properties page

1. **`PropertyRow` interface**: Agregar campos nuevos.
2. **`formatPrice`**: Respetar `price_exposure === false` → "Precio a consultar".
3. **`buildExtras`**: Agregar habitaciones ("3 hab · 5 amb · 1 baño"), expensas, badge "Barrio cerrado" si `zone_private_community`, badge "Emprendimiento" si `is_entrepreneurship`.
4. **Filtro por zona/barrio**: Agregar dropdown de barrio usando valores únicos de `zone_neighborhood`.
5. **Contacto directo**: Botones WhatsApp/email/tel en PropertyCard usando `contact_phone` y `contact_email`.
6. **Emprendimientos**: Si `is_entrepreneurship`, mostrar rango de precios y dormitorios del objeto `entrepreneurship`.

## Fase 5: PropertyCard component

1. Agregar props opcionales: `contactPhone`, `contactEmail`, `isEntrepreneurship`, `zoneBadge`, `isPrivateCommunity`.
2. Badge de barrio/zona sobre la imagen.
3. Botones de contacto directo (WhatsApp, email, llamar).
4. Label "Emprendimiento" / "En pozo".

---

## Detalles técnicos

- La migración agrega columnas con defaults NULL, no rompe datos existentes.
- El `external_id` seguirá siendo el campo de conflict resolution en upserts — se actualizará para usar `entityId` o el `id` numérico de Remax.
- La RPC `search_properties_filtered` se actualizará para devolver los campos nuevos.
- Se deployarán las edge functions `scrape-properties` y `chat` al final.
