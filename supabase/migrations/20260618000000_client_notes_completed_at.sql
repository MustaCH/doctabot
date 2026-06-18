-- client_notes.completed_at — timestamp real de completado de una nota-acción.
-- Hasta ahora el dashboard usaba created_at como proxy para "acciones completadas (7d)",
-- lo cual contaba mal (notas viejas completadas hoy no entraban; notas nuevas sin completar sí).
-- Ticket 86aj1nbnm.

-- 1) Columna
ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;

-- 2) Backfill: para las notas ya completadas, usamos created_at como mejor aproximación
--    disponible. Mantiene estable el número del dashboard durante la transición
--    (esas filas ya contaban vía created_at).
UPDATE public.client_notes
  SET completed_at = created_at
  WHERE is_done = true AND completed_at IS NULL;

-- 3) Trigger: única fuente de verdad para completed_at. Cubre los 3 call sites que
--    togglean is_done (tool del backend + Dashboard + ClientDetail) y cualquiera futuro.
--    is_done -> true  => completed_at = now()
--    is_done -> false => completed_at = null
CREATE OR REPLACE FUNCTION public.set_client_note_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_done AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    ELSIF NOT NEW.is_done THEN
      NEW.completed_at := NULL;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.is_done IS DISTINCT FROM OLD.is_done THEN
    NEW.completed_at := CASE WHEN NEW.is_done THEN now() ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS set_client_notes_completed_at ON public.client_notes;
CREATE TRIGGER set_client_notes_completed_at
  BEFORE INSERT OR UPDATE ON public.client_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_client_note_completed_at();

-- 4) Índice parcial para la query de "acciones completadas (7d)" del dashboard,
--    que corre en cada carga: eq(user_id) eq(is_action) eq(is_done) gte(completed_at).
CREATE INDEX IF NOT EXISTS idx_client_notes_completed_actions
  ON public.client_notes (user_id, completed_at)
  WHERE is_action = true AND is_done = true;
