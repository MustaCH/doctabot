-- Ticket 86aj9w5mh — Archivar supervisor_logs RECHAZADOS antes del purge a 90d.
-- Destino: tabla histórica en la misma DB (queryable para el golden set de evals, T1.1).
-- Volumen acotado: solo los rechazados (los approved se purgan como siempre).

-- 1) Tabla espejo + timestamp de archivado. LIKE INCLUDING ALL copia la PK (id):
--    el INSERT ... ON CONFLICT (id) DO NOTHING hace el archivado idempotente.
CREATE TABLE IF NOT EXISTS public.supervisor_logs_archive (
  LIKE public.supervisor_logs INCLUDING ALL
);
ALTER TABLE public.supervisor_logs_archive
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();

-- Interna (solo service_role): RLS sin policies = deny-all para anon/authenticated.
ALTER TABLE public.supervisor_logs_archive ENABLE ROW LEVEL SECURITY;

-- 2) cleanup_old_logs: archivar rechazados ANTES del delete (resto idéntico a 20260417192755).
CREATE OR REPLACE FUNCTION public.cleanup_old_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Export a cold storage (86aj9w5mh): los verdict='rejected' son los casos reales
  -- etiquetados que nutren el golden set — se preservan en el archive antes del purge.
  INSERT INTO public.supervisor_logs_archive
  SELECT s.*, now()
  FROM public.supervisor_logs s
  WHERE s.created_at < now() - INTERVAL '90 days'
    AND s.verdict = 'rejected'
  ON CONFLICT (id) DO NOTHING;

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
