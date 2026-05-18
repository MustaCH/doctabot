CREATE OR REPLACE FUNCTION public.search_properties_filtered(
  search_term text DEFAULT ''::text,
  op_filter text DEFAULT ''::text,
  type_filter text DEFAULT ''::text,
  price_min numeric DEFAULT NULL::numeric,
  price_max numeric DEFAULT NULL::numeric,
  neighborhood_filter text DEFAULT ''::text,
  city_filter text DEFAULT ''::text,
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0,
  rooms_min integer DEFAULT NULL,
  rooms_max integer DEFAULT NULL
)
RETURNS TABLE(
  id uuid, photo text, title text, office text, price numeric, currency text,
  address text, locality text, zone text, m2_total numeric, m2_cover numeric, url text,
  operation text, ambientes integer, banos integer, property_type text, created_at timestamp with time zone,
  total_count bigint, habitaciones integer, price_exposure boolean, expenses_price numeric,
  expenses_currency text, contact_phone text, contact_email text,
  zone_neighborhood text, zone_city text, zone_private_community text,
  is_entrepreneurship boolean, entrepreneurship jsonb, operation_id integer, photos text[]
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
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
    AND (rooms_min IS NULL OR p.habitaciones >= rooms_min)
    AND (rooms_max IS NULL OR p.habitaciones <= rooms_max)
  ORDER BY p.created_at DESC
  LIMIT page_size
  OFFSET page_offset;
$function$;