-- Auto-titulado: flag para no pisar títulos renombrados manualmente y cap a un re-titulado.
-- title_locked = true cuando: (a) el agente renombró la conversación a mano, o
-- (b) el background ya ejecutó su único re-titulado automático. En ambos casos el
-- re-titulado deja de correr. Las conversaciones existentes mantienen su título tal cual
-- (default false → siguen siendo elegibles para un re-titulado si cambian de foco).
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS title_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.conversations.title_locked IS
  'true = título fijado (rename manual o re-titulado automático ya ejecutado). Frena el auto-titulado.';
