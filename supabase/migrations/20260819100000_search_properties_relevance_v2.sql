-- Ticket 86ak2q73x — RPC search_properties_relevance v2: paridad COMPLETA con los filtros
-- del tool search_properties del executor (prerequisito para recablear el executor).
--
-- Cambios vs v1 (20260818200000): + min/max_ambientes, office, exclude_office (con el matiz
-- office-IS-NULL-pasa del executor), title substring, multi property_type con semántica
-- ilike-substring (la v1 usaba LIKE-prefijo), y currency por ILIKE substring (v1 usaba
-- igualdad — el executor usa ilike). NADIE llama la v1 todavía (el executor no está
-- integrado y el front usa search_properties_filtered) → DROP + CREATE es seguro.

DROP FUNCTION IF EXISTS public.search_properties_relevance(
  text, text[], text[], text[], text, text, text, text, text,
  numeric, numeric, text, integer, integer, boolean, boolean, integer, integer
);

CREATE OR REPLACE FUNCTION public.search_properties_relevance(
  search_term text DEFAULT '',            -- término libre (zona/desarrollo/título); '' = sin término
  zones text[] DEFAULT NULL,              -- OR de zonas (ilike, unaccent)
  exclude_zones text[] DEFAULT NULL,
  exclude_neighborhoods text[] DEFAULT NULL,
  locality_filter text DEFAULT '',
  neighborhood_filter text DEFAULT '',
  city_filter text DEFAULT '',
  op_filter text DEFAULT '',              -- igualdad exacta si viene (regímenes canónicos)
  op_filter_like text DEFAULT '',         -- fallback ILIKE para términos de operación no canónicos
  property_types text[] DEFAULT NULL,     -- OR de tipos, ILIKE substring (semántica del executor)
  title_filter text DEFAULT '',           -- substring sobre title (parámetro "title" del tool)
  price_min numeric DEFAULT NULL,
  price_max numeric DEFAULT NULL,
  currency_filter text DEFAULT '',        -- ILIKE substring (paridad executor; v1 usaba eq)
  rooms_min integer DEFAULT NULL,         -- habitaciones
  rooms_max integer DEFAULT NULL,
  amb_min integer DEFAULT NULL,           -- ambientes (v1 no los tenía)
  amb_max integer DEFAULT NULL,
  office_filter text DEFAULT '',          -- ILIKE substring
  exclude_office_filter text DEFAULT '',  -- office IS NULL también pasa (matiz m1 del executor)
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
  listing_status text, price_exposure boolean, expenses_price numeric, expenses_currency text,
  is_entrepreneurship boolean, entrepreneurship jsonb,
  relevance_score real, total_count bigint
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
      AND (op_filter_like = '' OR p.operation ILIKE '%' || op_filter_like || '%')
      AND (property_types IS NULL OR EXISTS (
        SELECT 1 FROM unnest(property_types) t
        WHERE p.property_type ILIKE '%' || t || '%'
      ))
      AND (title_filter = '' OR p.title ILIKE '%' || title_filter || '%')
      AND (currency_filter = '' OR p.currency ILIKE '%' || currency_filter || '%')
      AND (price_min IS NULL OR p.price >= price_min)
      AND (price_max IS NULL OR p.price <= price_max)
      AND (rooms_min IS NULL OR p.habitaciones >= rooms_min)
      AND (rooms_max IS NULL OR p.habitaciones <= rooms_max)
      AND (amb_min IS NULL OR p.ambientes >= amb_min)
      AND (amb_max IS NULL OR p.ambientes <= amb_max)
      AND (office_filter = '' OR p.office ILIKE '%' || office_filter || '%')
      AND (exclude_office_filter = '' OR p.office IS NULL OR p.office NOT ILIKE '%' || exclude_office_filter || '%')
  )
  SELECT
    s.id, s.photo, s.title, s.office, s.price, s.currency,
    s.address, s.locality, s.zone, s.m2_total, s.m2_cover, s.url,
    s.operation, s.ambientes, s.banos, s.property_type, s.created_at,
    s.habitaciones, s.photos, s.zone_neighborhood, s.zone_city,
    s.listing_status, s.price_exposure, s.expenses_price, s.expenses_currency,
    s.is_entrepreneurship, s.entrepreneurship,
    s.rel AS relevance_score,
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
