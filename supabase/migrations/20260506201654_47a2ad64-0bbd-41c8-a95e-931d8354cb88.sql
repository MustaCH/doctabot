
CREATE OR REPLACE FUNCTION public.admin_time_stats()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH since AS (SELECT now() - interval '30 days' AS dt),
  users_daily AS (
    SELECT created_at::date AS day, count(*) AS cnt
    FROM profiles WHERE created_at >= (SELECT dt FROM since)
    GROUP BY 1
  ),
  msgs_daily AS (
    SELECT created_at::date AS day, count(*) AS cnt
    FROM messages WHERE created_at >= (SELECT dt FROM since)
    GROUP BY 1
  ),
  convs_daily AS (
    SELECT created_at::date AS day, count(*) AS cnt
    FROM conversations WHERE created_at >= (SELECT dt FROM since)
    GROUP BY 1
  ),
  props_daily AS (
    SELECT created_at::date AS day, count(*) AS cnt
    FROM properties WHERE created_at >= (SELECT dt FROM since)
    GROUP BY 1
  ),
  to_obj AS (
    SELECT 'users' AS key, jsonb_object_agg(day::text, cnt) AS val FROM users_daily
    UNION ALL
    SELECT 'messages', jsonb_object_agg(day::text, cnt) FROM msgs_daily
    UNION ALL
    SELECT 'conversations', jsonb_object_agg(day::text, cnt) FROM convs_daily
    UNION ALL
    SELECT 'properties', jsonb_object_agg(day::text, cnt) FROM props_daily
  )
  SELECT jsonb_object_agg(key, coalesce(val, '{}'::jsonb)) FROM to_obj;
$$;
