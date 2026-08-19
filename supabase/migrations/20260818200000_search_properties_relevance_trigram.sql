-- Ticket 86aj9w5nx — Retrieval etapa 1: trigram + RPC con relevance_score
-- NUEVA función search_properties_relevance (la search_properties_filtered del front queda
-- intacta). unaccent inmutable como wrapper (requisito para índices por expresión).

-- 1) Extensión pg_trgm (unaccent ya existe — la usa search_properties_filtered)
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 2) Wrapper IMMUTABLE de unaccent (unaccent() es STABLE y no se puede indexar por expresión)
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
SET search_path TO 'public', 'extensions'
AS $$ SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

-- 3) Índices trigram sobre lo que busca Alan (título y zona son el 90% del retrieval)
CREATE INDEX IF NOT EXISTS idx_properties_title_trgm
  ON public.properties USING gin (public.immutable_unaccent(lower(coalesce(title, ''))) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_properties_zone_trgm
  ON public.properties USING gin (public.immutable_unaccent(lower(coalesce(zone, ''))) extensions.gin_trgm_ops);

-- 4) RPC de retrieval para el tool de Alan
CREATE OR REPLACE FUNCTION public.search_properties_relevance(
  search_term text DEFAULT '',            -- término libre (zona/desarrollo/título); '' = sin término
  zones text[] DEFAULT NULL,              -- OR de zonas (ilike, unaccent)
  exclude_zones text[] DEFAULT NULL,
  exclude_neighborhoods text[] DEFAULT NULL,
  locality_filter text DEFAULT '',
  neighborhood_filter text DEFAULT '',
  city_filter text DEFAULT '',
  op_filter text DEFAULT '',              -- igualdad exacta si viene (regímenes canónicos)
  type_filter text DEFAULT '',
  price_min numeric DEFAULT NULL,
  price_max numeric DEFAULT NULL,
  currency_filter text DEFAULT '',
  rooms_min integer DEFAULT NULL,
  rooms_max integer DEFAULT NULL,
  filter_active boolean DEFAULT true,     -- listing_status active O NULL (legacy)
  docta_first boolean DEFAULT true,
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, photo text, title text, office text, price numeric, currency text,
  address text, locality text, zone text, m2_total numeric, m2_cover numeric, url text,
  operation text, ambientes integer, banos integer, property_type text, created_at timestamptz,
  habitaciones integer, photos text[], zone_neighborhood text, zone_city text,
  listing_status text, relevance_score real, total_count bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  WITH scored AS (
    SELECT p.*,
      CASE
        WHEN search_term = '' THEN 1.0::real
        ELSE GREATEST(
          similarity(public.immutable_unaccent(lower(coalesce(p.title,''))), public.immutable_unaccent(lower(search_term))),
          similarity(public.immutable_unaccent(lower(coalesce(p.zone,''))), public.immutable_unaccent(lower(search_term))),
          similarity(public.immutable_unaccent(lower(coalesce(p.locality,''))), public.immutable_unaccent(lower(search_term))),
          similarity(public.immutable_unaccent(lower(coalesce(p.zone_neighborhood,''))), public.immutable_unaccent(lower(search_term)))
        )
      END AS rel
    FROM properties p
    WHERE
      (NOT filter_active OR p.listing_status = 'active' OR p.listing_status IS NULL)
      AND (zones IS NULL OR EXISTS (
        SELECT 1 FROM unnest(zones) z
        WHERE public.immutable_unaccent(lower(coalesce(p.zone,''))) ILIKE '%' || public.immutable_unaccent(lower(z)) || '%'
      ))
      AND (exclude_zones IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(exclude_zones) z
        WHERE public.immutable_unaccent(lower(coalesce(p.zone,''))) ILIKE '%' || public.immutable_unaccent(lower(z)) || '%'
      ))
      AND (exclude_neighborhoods IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(exclude_neighborhoods) n
        WHERE public.immutable_unaccent(lower(coalesce(p.zone_neighborhood,''))) ILIKE '%' || public.immutable_unaccent(lower(n)) || '%'
      ))
      AND (locality_filter = '' OR public.immutable_unaccent(lower(coalesce(p.locality,''))) ILIKE '%' || public.immutable_unaccent(lower(locality_filter)) || '%')
      AND (neighborhood_filter = '' OR public.immutable_unaccent(lower(coalesce(p.zone_neighborhood,''))) ILIKE '%' || public.immutable_unaccent(lower(neighborhood_filter)) || '%')
      AND (city_filter = '' OR public.immutable_unaccent(lower(coalesce(p.zone_city,''))) ILIKE '%' || public.immutable_unaccent(lower(city_filter)) || '%')
      AND (op_filter = '' OR p.operation = op_filter)
      AND (type_filter = '' OR lower(p.property_type) LIKE lower(type_filter) || '%')
      AND (currency_filter = '' OR p.currency = currency_filter)
      AND (price_min IS NULL OR p.price >= price_min)
      AND (price_max IS NULL OR p.price <= price_max)
      AND (rooms_min IS NULL OR p.habitaciones >= rooms_min)
      AND (rooms_max IS NULL OR p.habitaciones <= rooms_max)
  )
  SELECT
    s.id, s.photo, s.title, s.office, s.price, s.currency,
    s.address, s.locality, s.zone, s.m2_total, s.m2_cover, s.url,
    s.operation, s.ambientes, s.banos, s.property_type, s.created_at,
    s.habitaciones, s.photos, s.zone_neighborhood, s.zone_city,
    s.listing_status, s.rel AS relevance_score,
    count(*) OVER() AS total_count
  FROM scored s
  WHERE search_term = '' OR s.rel >= 0.25
     OR public.immutable_unaccent(lower(coalesce(s.title,''))) ILIKE '%' || public.immutable_unaccent(lower(search_term)) || '%'
  ORDER BY
    (docta_first AND s.office ILIKE '%docta%') DESC,
    s.rel DESC,
    s.created_at DESC
  LIMIT page_size
  OFFSET page_offset;
$function$;
