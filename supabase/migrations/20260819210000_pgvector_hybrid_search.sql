-- Ticket 86aj9w5pn — Retrieval etapa 2: pgvector + hybrid search.
-- SQL de columna/índice aprobado por Nacho (comentario del ticket, 2026-08-19).
--
-- (1) Infra: extensión vector + columna embedding (768 dims: gemini-embedding-001 con
--     outputDimensionality=768; el cliente NORMALIZA L2 antes de guardar/consultar porque a
--     <3072 dims el modelo devuelve vectores sin normalizar — verificado con sonda) + índice
--     HNSW por coseno.
-- (2) RPC v3: search_properties_relevance suma el parámetro OPCIONAL query_embedding.
--     Con embedding presente (query Y fila), el relevance_score pasa a ser HÍBRIDO:
--     0.6·trigram + 0.4·(1 − distancia coseno). Sin query_embedding (default NULL) o en filas
--     sin backfill, el comportamiento es EXACTAMENTE el de la v2 (trigram puro) — fail-open.
--     DROP + CREATE (no OR REPLACE) porque cambia la firma: dejar la v2 viva crearía un
--     overload ambiguo para las llamadas por nombre de PostgREST.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(768);

CREATE INDEX IF NOT EXISTS properties_embedding_hnsw
  ON public.properties USING hnsw (embedding extensions.vector_cosine_ops);

DROP FUNCTION IF EXISTS public.search_properties_relevance(
  text, text[], text[], text[], text, text, text, text, text, text[], text,
  numeric, numeric, text, integer, integer, integer, integer, text, text,
  boolean, boolean, integer, integer
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
  currency_filter text DEFAULT '',        -- ILIKE substring (paridad executor)
  rooms_min integer DEFAULT NULL,         -- habitaciones
  rooms_max integer DEFAULT NULL,
  amb_min integer DEFAULT NULL,           -- ambientes
  amb_max integer DEFAULT NULL,
  office_filter text DEFAULT '',          -- ILIKE substring
  exclude_office_filter text DEFAULT '',  -- office IS NULL también pasa (matiz m1 del executor)
  filter_active boolean DEFAULT true,     -- listing_status active O NULL (legacy)
  docta_first boolean DEFAULT true,
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0,
  query_embedding extensions.vector(768) DEFAULT NULL  -- v3: recall vectorial opcional (hybrid)
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
      END AS rel_tri,
      CASE
        WHEN query_embedding IS NULL OR p.embedding IS NULL THEN NULL::real
        ELSE (1 - (p.embedding <=> query_embedding))::real
      END AS rel_vec
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
  ),
  hybrid AS (
    SELECT s.*,
      CASE
        WHEN s.rel_vec IS NULL THEN s.rel_tri
        ELSE (0.6 * s.rel_tri + 0.4 * s.rel_vec)::real
      END AS rel
    FROM scored s
  )
  SELECT
    h.id, h.photo, h.title, h.office, h.price, h.currency,
    h.address, h.locality, h.zone, h.m2_total, h.m2_cover, h.url,
    h.operation, h.ambientes, h.banos, h.property_type, h.created_at,
    h.habitaciones, h.photos, h.zone_neighborhood, h.zone_city,
    h.listing_status, h.price_exposure, h.expenses_price, h.expenses_currency,
    h.is_entrepreneurship, h.entrepreneurship,
    h.rel AS relevance_score,
    count(*) OVER() AS total_count
  FROM hybrid h
  WHERE search_term = '' OR h.rel >= 0.25
     OR public.immutable_unaccent(lower(coalesce(h.title,''))) ILIKE '%' || public.immutable_unaccent(lower(search_term)) || '%'
  ORDER BY
    (docta_first AND h.office ILIKE '%docta%') DESC,
    h.rel DESC,
    h.created_at DESC
  LIMIT page_size
  OFFSET page_offset;
$function$;
