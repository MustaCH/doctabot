-- Ticket 86aj9w5nt — daily-followups: due_at en tareas + log de dedup + cron diario

-- 1) client_notes.due_at: vencimiento de la tarea (AC). NULL = sin vencimiento (no se nudgea).
ALTER TABLE public.client_notes ADD COLUMN IF NOT EXISTS due_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_client_notes_due
  ON public.client_notes (user_id, due_at)
  WHERE is_action = true AND is_done = false AND due_at IS NOT NULL;

-- 2) Log de nudges enviados (dedup): eventos dedupean por (ref, occurrence);
--    tareas y clientes-sin-seguimiento renuevan cooldown con cada fila (log, SIN unique).
CREATE TABLE IF NOT EXISTS public.notified_followups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('task', 'event', 'stale')),
  ref_id uuid NOT NULL,
  occurrence text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notified_followups_user ON public.notified_followups (user_id, created_at DESC);

-- Tabla interna (solo la toca la Edge Function con service_role): RLS sin policies = deny-all
-- para anon/authenticated, mismo patrón que invitation_codes.
ALTER TABLE public.notified_followups ENABLE ROW LEVEL SECURITY;

-- 3) Cron diario 11:00 UTC = 08:00 Córdoba (antes del arranque laboral, después del
--    morning-matches de las 12:00 UTC no — corre antes; son independientes).
--    Mismo patrón que health-monitor/morning-matches: net.http_post con bearer ANON (public).
DO $$
DECLARE job_id BIGINT;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'daily-followups';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'daily-followups',
  '0 11 * * *',
  $$
  select net.http_post(
    url := 'https://osrphpndujdelfyetoah.supabase.co/functions/v1/daily-followups',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zcnBocG5kdWpkZWxmeWV0b2FoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNjg0MDQsImV4cCI6MjA5Njc0NDQwNH0.hEQTdaxclVQy49wx3b95eruuVxVUqK6uY7pjX5VdT1k"}'::jsonb,
    body := '{"source":"cron"}'::jsonb
  ) as request_id;
  $$
);
