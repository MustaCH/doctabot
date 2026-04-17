-- ============= INDEXES =============
-- Speed up message retrieval per conversation ordered by time
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at DESC);

-- Speed up supervisor dashboard queries (ordered by recency, sometimes filtered by user)
CREATE INDEX IF NOT EXISTS idx_supervisor_logs_created
  ON public.supervisor_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supervisor_logs_user_created
  ON public.supervisor_logs (user_id, created_at DESC);

-- Speed up scraping monitor (ordered by recency, batch grouping)
CREATE INDEX IF NOT EXISTS idx_scraping_logs_created
  ON public.scraping_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scraping_logs_batch_created
  ON public.scraping_logs (batch_id, created_at DESC);

-- Speed up activity log per client
CREATE INDEX IF NOT EXISTS idx_client_activity_log_client_created
  ON public.client_activity_log (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_activity_log_user_created
  ON public.client_activity_log (user_id, created_at DESC);

-- ============= RETENTION FUNCTION =============
CREATE OR REPLACE FUNCTION public.cleanup_old_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Supervisor logs older than 90 days
  DELETE FROM public.supervisor_logs
  WHERE created_at < now() - INTERVAL '90 days';

  -- Scraping logs older than 30 days
  DELETE FROM public.scraping_logs
  WHERE created_at < now() - INTERVAL '30 days';

  -- Client activity log older than 180 days
  DELETE FROM public.client_activity_log
  WHERE created_at < now() - INTERVAL '180 days';
END;
$$;

-- ============= ENABLE pg_cron =============
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Schedule daily cleanup at 06:00 UTC = 03:00 ART
-- Drop existing job if present (idempotent)
DO $$
DECLARE
  job_id BIGINT;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'cleanup_old_logs_daily';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'cleanup_old_logs_daily',
  '0 6 * * *',
  $$ SELECT public.cleanup_old_logs(); $$
);