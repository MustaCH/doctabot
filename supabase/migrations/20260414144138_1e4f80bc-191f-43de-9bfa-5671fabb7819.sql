
DROP EXTENSION IF EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.search_properties_filtered(
  search_term text DEFAULT '',
  op_filter text DEFAULT '',
  type_filter text DEFAULT '',
  price_min numeric DEFAULT NULL,
  price_max numeric DEFAULT NULL,
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  photo text,
  title text,
  office text,
  price numeric,
  currency text,
  address text,
  locality text,
  zone text,
  m2_total numeric,
  m2_cover numeric,
  url text,
  operation text,
  ambientes integer,
  banos integer,
  property_type text,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT 
    p.id, p.photo, p.title, p.office, p.price, p.currency,
    p.address, p.locality, p.zone, p.m2_total, p.m2_cover, p.url,
    p.operation, p.ambientes, p.banos, p.property_type, p.created_at,
    count(*) OVER() as total_count
  FROM properties p
  WHERE
    (search_term = '' OR (
      unaccent(coalesce(p.title,'')) ilike '%' || unaccent(search_term) || '%'
      OR unaccent(coalesce(p.address,'')) ilike '%' || unaccent(search_term) || '%'
      OR unaccent(coalesce(p.locality,'')) ilike '%' || unaccent(search_term) || '%'
      OR unaccent(coalesce(p.zone,'')) ilike '%' || unaccent(search_term) || '%'
      OR unaccent(coalesce(p.office,'')) ilike '%' || unaccent(search_term) || '%'
    ))
    AND (op_filter = '' OR p.operation = op_filter)
    AND (type_filter = '' OR p.property_type = type_filter)
    AND (price_min IS NULL OR p.price >= price_min)
    AND (price_max IS NULL OR p.price <= price_max)
  ORDER BY p.created_at DESC
  LIMIT page_size
  OFFSET page_offset;
$$;
