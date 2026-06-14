-- Columna aditiva para categorizar los veredictos del supervisor y hacer agregable el
-- loop de mejora (motivos de rechazo dejan de ser prosa libre). Ver ticket 86aj1f1up.
-- Aditiva y no destructiva: nullable, sin default, sin backfill.
ALTER TABLE public.supervisor_logs ADD COLUMN IF NOT EXISTS category text;
