
-- 1. user_reports: aggregate per-user stats using SQL instead of fetching all rows
CREATE OR REPLACE FUNCTION public.admin_user_reports()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  );
$$;

-- 2. engagement_report: aggregate 30-day engagement using SQL
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
