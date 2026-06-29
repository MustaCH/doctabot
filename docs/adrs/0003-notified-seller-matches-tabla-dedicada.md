# ADR-003: Tabla dedicada para notificaciones seller→buyer

**Estado:** Aceptado
**Fecha:** 2026-06-18
**Decisor(es):** Nacho + Backend Developer agent

## Contexto

`morning-matches` genera dos tipos de match:

1. **buyer→propiedad** (`processBuyerSlice`): a un comprador le aparecen propiedades nuevas que matchean.
2. **seller→buyer** (`processSellerSlice`): a un vendedor le aparecen compradores que podrían interesarse en su inmueble.

Ambos usaban la misma tabla `notified_matches` (que sirve para el dedup —no re-notificar el mismo match— y para reconstruir los push de cierre de corrida). La tabla fue diseñada para el caso buyer:

```sql
property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
UNIQUE (user_id, client_id, property_id)
```

La fase seller **sobrecargaba** ese esquema guardando `client_id = seller.id`, `property_id = buyer.id`. Pero `buyer.id` es un `clients.id`, no un `properties.id` → el FK `notified_matches_property_id_fkey` lo rechaza **siempre** (PG 23503).

**Evidencia (DB Doctabot, 2026-06-18):** 2071 filas en `notified_matches`, **0** con `property_id` apuntando a un cliente, con 892 sellers activos → la fase seller nunca insertó una sola fila en producción. Overlord reportó el 23503 22 veces el 2026-06-17.

Consecuencias del bug, más allá del error logueado:
- El dedup de sellers lee `notified_matches`; como esas filas nunca persistían, **los vendedores se re-notificaban en cada corrida** (conversaciones/mensajes/push duplicados a diario).
- Los push de "Compradores encontrados" tampoco disparaban (se reconstruían desde filas que no existían).

La decisión de fondo es de modelo de datos: **¿cómo se trackea un par seller→buyer, que por naturaleza referencia dos `clients`, no una `property`?**

## Decisión

Tabla dedicada `notified_seller_matches` con FKs correctas a `clients`:

```sql
CREATE TABLE public.notified_seller_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  seller_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  buyer_client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, seller_client_id, buyer_client_id)
);
```

`notified_matches` queda **exclusivamente** para matches buyer→propiedad. `processSellerSlice` (dedup + insert) y `sendRunPushes` (rama seller) pasan a usar la tabla nueva.

## Alternativas consideradas

### Opción A: Columna `matched_client_id` en `notified_matches`
- `property_id` pasa a nullable + nueva columna FK a `clients`; buyer usa una, seller la otra.
- **Contra:** el `UNIQUE (user_id, client_id, property_id)` deja de servir para sellers (los NULL son distintos en un UNIQUE) → habría que mantener índices únicos parciales por tipo de fila. El dedup queda enredado y la tabla, semánticamente ambigua (¿qué fila es de qué tipo?).
- **Por qué no:** más frágil para igual cantidad de trabajo.

### Opción B: Relajar/dropear el FK `property_id`
- `property_id` se vuelve un id opaco (propiedad o cliente).
- **Contra:** se pierde la integridad referencial y el `ON DELETE CASCADE` que limpia los matches cuando se borra una propiedad (cosa que pasa seguido: `scrape-properties` borra obsoletas). Habría que reimplementar la limpieza con trigger o a mano, y se abren huérfanos reales.
- **Por qué no:** sacrifica integridad para ahorrar una tabla.

### Opción C (elegida): Tabla dedicada
- Cada concepto con su FK e índice; `notified_matches` recupera su invariante (siempre apunta a una propiedad real).
- **Costo:** una migración + tocar `processSellerSlice` y `sendRunPushes`.

## Consecuencias

### Positivas
- Desaparece el PG 23503 de la fase seller y el dedup seller→buyer por fin persiste → se corta el spam de re-notificación diaria.
- Los push de "Compradores encontrados" pasan a funcionar.
- `notified_matches.property_id` mantiene su FK e invariante; integridad intacta en ambos caminos.

### Negativas / deuda
- Dos tablas de "ya notifiqué" en vez de una. Aceptado: el costo cognitivo es menor que el de sobrecargar una sola columna.

### Neutras
- No hay datos seller que migrar: nunca existieron filas seller en `notified_matches` (0 confirmado), así que la migración es puramente aditiva.
- Bug hermano relacionado: el upsert de `properties` (PG 21000) se resolvió aparte (dedup por `external_id`); reducía la cantidad de propiedades insertadas pero no era causa de este 23503.

## Notas de implementación

- Migración `supabase/migrations/20260618130000_notified_seller_matches.sql` (tabla + RLS + índices). Validada con `BEGIN; … ROLLBACK;` contra la DB real (insert con seller+buyer reales pasa el FK; dedup `ON CONFLICT` funciona).
- `morning-matches/index.ts`:
  - `processSellerSlice`: dedup lee `notified_seller_matches`; insert va a esa tabla con `onConflict: "user_id,seller_client_id,buyer_client_id"`.
  - `processBuyerSlice`: además, valida que las propiedades sigan existiendo antes del insert (evita el 23503 por race con el borrado de obsoletas de `scrape-properties`).
  - `sendRunPushes`: rama buyer desde `notified_matches`, rama seller desde `notified_seller_matches` (join a `clients` en dos pasos por tener dos FKs a la misma tabla).
- Deploy: migración → deploy de la edge function `morning-matches`. La edge nueva depende de que la tabla exista.

## Referencias

- Tickets ClickUp (Space ALAN): `86aj3trk8` (este bug), `86aj3huju` (upsert PG 21000, hermano).
- Migración: `supabase/migrations/20260414185900_*.sql` (definición original de `notified_matches`).
