-- Observabilidad: heartbeat de uptime cada 10 min vía pg_cron + pg_net.
-- Ticket 86aj18r6x. Dispara la Edge Function health-monitor, que corre los checks
-- (front, chat, spike de errores, frescura de scraper/morning-matches) y, si algo
-- falla, postea una alerta consolidada a N8N_WEBHOOK_URL.
--
-- Mismo patrón que los crons existentes (nightly-scrape-properties / morning-property-
-- matches): net.http_post con bearer de la ANON key (public, no service role).

-- Idempotente: desagendar si ya existía (re-aplicar la migración no duplica el job).
DO $$
DECLARE job_id BIGINT;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'health-monitor';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'health-monitor',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://osrphpndujdelfyetoah.supabase.co/functions/v1/health-monitor',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zcnBocG5kdWpkZWxmeWV0b2FoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNjg0MDQsImV4cCI6MjA5Njc0NDQwNH0.hEQTdaxclVQy49wx3b95eruuVxVUqK6uY7pjX5VdT1k"}'::jsonb,
    body := '{"source":"cron"}'::jsonb
  ) as request_id;
  $$
);
