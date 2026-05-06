
-- Add new columns to properties table
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS remax_id integer,
  ADD COLUMN IF NOT EXISTS entity_id text,
  ADD COLUMN IF NOT EXISTS operation_id integer,
  ADD COLUMN IF NOT EXISTS property_type_id integer,
  ADD COLUMN IF NOT EXISTS listing_status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS is_entrepreneurship boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_exposure boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS expenses_price numeric,
  ADD COLUMN IF NOT EXISTS expenses_currency text,
  ADD COLUMN IF NOT EXISTS habitaciones integer,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS office_id text,
  ADD COLUMN IF NOT EXISTS associate_id text,
  ADD COLUMN IF NOT EXISTS zone_data jsonb,
  ADD COLUMN IF NOT EXISTS zone_neighborhood text,
  ADD COLUMN IF NOT EXISTS zone_city text,
  ADD COLUMN IF NOT EXISTS zone_county text,
  ADD COLUMN IF NOT EXISTS zone_private_community text,
  ADD COLUMN IF NOT EXISTS entrepreneurship jsonb,
  ADD COLUMN IF NOT EXISTS photos text[];

-- Add indexes for commonly filtered columns
CREATE INDEX IF NOT EXISTS idx_properties_zone_neighborhood ON public.properties (zone_neighborhood);
CREATE INDEX IF NOT EXISTS idx_properties_zone_city ON public.properties (zone_city);
CREATE INDEX IF NOT EXISTS idx_properties_operation_id ON public.properties (operation_id);
CREATE INDEX IF NOT EXISTS idx_properties_remax_id ON public.properties (remax_id);

-- Replace search_properties_filtered to include new fields
CREATE OR REPLACE FUNCTION public.search_properties_filtered(
  search_term text DEFAULT '',
  op_filter text DEFAULT '',
  type_filter text DEFAULT '',
  price_min numeric DEFAULT NULL,
  price_max numeric DEFAULT NULL,
  neighborhood_filter text DEFAULT '',
  city_filter text DEFAULT '',
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, photo text, title text, office text, price numeric, currency text,
  address text, locality text, zone text, m2_total numeric, m2_cover numeric,
  url text, operation text, ambientes integer, banos integer, property_type text,
  created_at timestamp with time zone, total_count bigint,
  habitaciones integer, price_exposure boolean, expenses_price numeric,
  expenses_currency text, contact_phone text, contact_email text,
  zone_neighborhood text, zone_city text, zone_private_community text,
  is_entrepreneurship boolean, entrepreneurship jsonb, operation_id integer,
  photos text[]
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT 
    p.id, p.photo, p.title, p.office, p.price, p.currency,
    p.address, p.locality, p.zone, p.m2_total, p.m2_cover, p.url,
    p.operation, p.ambientes, p.banos, p.property_type, p.created_at,
    count(*) OVER() as total_count,
    p.habitaciones, p.price_exposure, p.expenses_price,
    p.expenses_currency, p.contact_phone, p.contact_email,
    p.zone_neighborhood, p.zone_city, p.zone_private_community,
    p.is_entrepreneurship, p.entrepreneurship, p.operation_id,
    p.photos
  FROM properties p
  WHERE
    (search_term = '' OR (
      unaccent(coalesce(p.title,'')) ilike '%' || unaccent(search_term) || '%'
      OR unaccent(coalesce(p.address,'')) ilike '%' || unaccent(search_term) || '%'
      OR unaccent(coalesce(p.locality,'')) ilike '%' || unaccent(search_term) || '%'
      OR unaccent(coalesce(p.zone,'')) ilike '%' || unaccent(search_term) || '%'
      OR unaccent(coalesce(p.zone_neighborhood,'')) ilike '%' || unaccent(search_term) || '%'
      OR unaccent(coalesce(p.zone_city,'')) ilike '%' || unaccent(search_term) || '%'
    ))
    AND (op_filter = '' OR p.operation = op_filter)
    AND (type_filter = '' OR
         lower(p.property_type) LIKE lower(type_filter) || '%'
         OR (lower(type_filter) = 'terreno' AND lower(p.property_type) LIKE 'terreno%')
    )
    AND (price_min IS NULL OR p.price >= price_min)
    AND (price_max IS NULL OR p.price <= price_max)
    AND (neighborhood_filter = '' OR unaccent(coalesce(p.zone_neighborhood,'')) ilike '%' || unaccent(neighborhood_filter) || '%')
    AND (city_filter = '' OR unaccent(coalesce(p.zone_city,'')) ilike '%' || unaccent(city_filter) || '%')
  ORDER BY p.created_at DESC
  LIMIT page_size
  OFFSET page_offset;
$$;
