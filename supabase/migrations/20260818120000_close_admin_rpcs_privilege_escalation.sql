-- Cierra escalada de privilegios cross-tenant en las RPCs admin (ticket 86aj9w5jm).
-- Antes: SECURITY DEFINER sin chequeo de rol y con EXECUTE por defecto para PUBLIC,
-- cualquier usuario authenticated podía llamarlas por PostgREST y leer stats de todos.
-- Ahora: (1) guard de rol dentro de cada función (defensa en profundidad) y
-- (2) REVOKE de EXECUTE para PUBLIC/anon/authenticated, con GRANT explícito a service_role.
-- El guard acepta auth.role()='service_role' porque la Edge Function admin-stats llama
-- con la service key (auth.uid() es NULL en ese caso).

CREATE OR REPLACE FUNCTION public.assert_admin_rpc_access()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN;
  END IF;
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- admin_user_reports: pasa de LANGUAGE sql a plpgsql para poder ejecutar el guard;
-- la query es idéntica a la de 20260506201553, envuelta en RETURN (...).
CREATE OR REPLACE FUNCTION public.admin_user_reports()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_admin_rpc_access();
  RETURN (
    WITH super_admins AS (
      SELECT user_id FROM user_roles WHERE role = 'super_admin'
    ),
    all_profiles AS (
      SELECT user_id, full_name FROM profiles
      WHERE user_id NOT IN (SELECT user_id FROM super_admins)
    ),
    conv_counts AS (
      SELECT user_id, count(*) AS cnt
      FROM conversations
      WHERE user_id NOT IN (SELECT user_id FROM super_admins)
      GROUP BY user_id
    ),
    msg_counts AS (
      SELECT c.user_id, count(m.id) AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id NOT IN (SELECT user_id FROM super_admins)
      GROUP BY c.user_id
    ),
    client_counts AS (
      SELECT user_id, count(*) AS cnt
      FROM clients
      GROUP BY user_id
    ),
    client_status_counts AS (
      SELECT user_id, coalesce(status, 'unknown') AS status, count(*) AS cnt
      FROM clients
      GROUP BY user_id, coalesce(status, 'unknown')
    ),
    fav_counts AS (
      SELECT user_id, count(*) AS cnt
      FROM favorites
      GROUP BY user_id
    ),
    last_activity AS (
      SELECT c.user_id, max(greatest(c.created_at, m.created_at)) AS last_act
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.user_id NOT IN (SELECT user_id FROM super_admins)
      GROUP BY c.user_id
    ),
    client_dist AS (
      SELECT jsonb_object_agg(status, cnt) AS dist
      FROM (SELECT coalesce(status,'unknown') AS status, count(*) AS cnt FROM clients GROUP BY 1) sub
    )
    SELECT jsonb_build_object(
      'users', (
        SELECT coalesce(jsonb_agg(row_data ORDER BY (row_data->>'messages')::int DESC), '[]'::jsonb)
        FROM (
          SELECT jsonb_build_object(
            'user_id', p.user_id,
            'full_name', p.full_name,
            'messages', coalesce(mc.cnt, 0),
            'conversations', coalesce(cc.cnt, 0),
            'clients', coalesce(cl.cnt, 0),
            'favorites', coalesce(fc.cnt, 0),
            'lastActivity', la.last_act,
            'avgMessagesPerConv', CASE WHEN coalesce(cc.cnt,0) > 0 THEN round((coalesce(mc.cnt,0)::numeric / cc.cnt) * 10) / 10 ELSE 0 END,
            'clientsByStatus', coalesce((SELECT jsonb_object_agg(cs.status, cs.cnt) FROM client_status_counts cs WHERE cs.user_id = p.user_id), '{}'::jsonb)
          ) AS row_data
          FROM all_profiles p
          LEFT JOIN conv_counts cc ON cc.user_id = p.user_id
          LEFT JOIN msg_counts mc ON mc.user_id = p.user_id
          LEFT JOIN client_counts cl ON cl.user_id = p.user_id
          LEFT JOIN fav_counts fc ON fc.user_id = p.user_id
          LEFT JOIN last_activity la ON la.user_id = p.user_id
        ) sub
      ),
      'clientDistribution', coalesce((SELECT dist FROM client_dist), '{}'::jsonb)
    )
  );
END;
$$;

-- admin_engagement_report: ya era plpgsql; solo se agrega el guard al inicio.
CREATE OR REPLACE FUNCTION public.admin_engagement_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  since_date timestamptz := now() - interval '30 days';
BEGIN
  PERFORM public.assert_admin_rpc_access();
  WITH super_admins AS (
    SELECT user_id FROM user_roles WHERE role = 'super_admin'
  ),
  valid_convs AS (
    SELECT id, user_id, created_at
    FROM conversations
    WHERE created_at >= since_date
      AND user_id NOT IN (SELECT user_id FROM super_admins)
  ),
  valid_msgs AS (
    SELECT m.id, m.conversation_id, m.role, m.created_at, vc.user_id
    FROM messages m
    JOIN valid_convs vc ON vc.id = m.conversation_id
  ),
  daily AS (
    SELECT
      (m.created_at AT TIME ZONE 'UTC')::date AS day,
      count(*) AS messages,
      count(DISTINCT m.user_id) AS active_users
    FROM valid_msgs m
    GROUP BY 1
  ),
  day_series AS (
    SELECT generate_series(
      (now() - interval '29 days')::date,
      now()::date,
      '1 day'::interval
    )::date AS day
  ),
  daily_filled AS (
    SELECT
      to_char(ds.day, 'MM-DD') AS date,
      coalesce(d.messages, 0) AS messages,
      coalesce(d.active_users, 0) AS "activeUsers"
    FROM day_series ds
    LEFT JOIN daily d ON d.day = ds.day
    ORDER BY ds.day
  ),
  conv_lengths AS (
    SELECT conversation_id, count(*) AS cnt
    FROM valid_msgs WHERE role = 'user'
    GROUP BY conversation_id
  )
  SELECT jsonb_build_object(
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', date, 'messages', messages, 'activeUsers', "activeUsers")), '[]'::jsonb) FROM daily_filled),
    'avgConvLength', (SELECT CASE WHEN count(*) > 0 THEN round(avg(cnt)::numeric, 1) ELSE 0 END FROM conv_lengths),
    'totalActiveUsers', (SELECT count(DISTINCT user_id) FROM valid_msgs),
    'totalMessages', (SELECT count(*) FROM valid_msgs),
    'totalConversations', (SELECT count(*) FROM valid_convs)
  ) INTO result;

  RETURN result;
END;
$$;

-- admin_time_stats: pasa de LANGUAGE sql a plpgsql para poder ejecutar el guard;
-- query idéntica a la de 20260506201654, envuelta en RETURN (...).
CREATE OR REPLACE FUNCTION public.admin_time_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_admin_rpc_access();
  RETURN (
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
    SELECT jsonb_object_agg(key, coalesce(val, '{}'::jsonb)) FROM to_obj
  );
END;
$$;

-- Sin EXECUTE desde el browser: PostgREST corta antes de llegar al guard.
REVOKE EXECUTE ON FUNCTION public.admin_user_reports() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_engagement_report() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_time_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_admin_rpc_access() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_user_reports() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_engagement_report() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_time_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_admin_rpc_access() TO service_role;
