-- Estados de cliente: cerrar el enum a nivel DB (hot|warm|cold) + default 'warm'.
-- Hasta acá el cierre vivía solo en el código (normalizeClientStatus / tipos del front);
-- la DB aceptaba cualquier string y el default histórico era 'prospect' (legacy).
--
-- 1) Normalización de filas legacy ANTES del CHECK. Mapeo elegido:
--    - 'prospect' → 'warm'  (un prospecto es alguien en seguimiento, no frío)
--    - 'active'   → 'warm'  (cliente en curso; 'hot' sería asumir interés que no consta)
--    - 'inactive' → 'cold'  (sin actividad)
--    - 'closed'   → 'cold'  (operación concluida; alineado con la sugerencia del prompt)
--    - cualquier otro valor desconocido → 'warm' (neutro: queda visible en cruces/campañas
--      sin marcar un interés que nadie registró).
UPDATE public.clients SET status = 'cold' WHERE status IN ('inactive', 'closed');
UPDATE public.clients SET status = 'warm' WHERE status NOT IN ('hot', 'warm', 'cold');

-- 2) Default nuevo: 'warm' (antes 'prospect', que el CHECK de abajo ya no permitiría).
ALTER TABLE public.clients ALTER COLUMN status SET DEFAULT 'warm';

-- 3) Enum cerrado a nivel DB (defensa real: las edge functions usan service_role y cualquier
--    bug de validación en código quedaba persistido).
ALTER TABLE public.clients
  ADD CONSTRAINT clients_status_check CHECK (status IN ('hot', 'warm', 'cold'));
