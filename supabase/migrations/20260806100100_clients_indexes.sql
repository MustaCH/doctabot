-- Índices para las queries calientes sobre clients (todas scopeadas por user_id):
-- - listados ordenados por actividad reciente (updated_at DESC),
-- - rotación de campañas least_contacted (last_contact_at ASC NULLS FIRST: los nunca
--   contactados primero, mismo orden que usa list_clients),
-- - filtro cliente vs contacto (is_client),
-- - búsqueda por nombre con ilike/%...% (trigram GIN, requiere pg_trgm).

CREATE INDEX IF NOT EXISTS idx_clients_user_updated
  ON public.clients (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_clients_user_last_contact
  ON public.clients (user_id, last_contact_at NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_clients_user_is_client
  ON public.clients (user_id, is_client);

-- pg_trgm va al schema `extensions`, NO a public (mismo criterio que unaccent en
-- 20260414144138: los security advisors marcan extensiones en public). El opclass se
-- referencia schema-qualified porque `extensions` no está en el search_path por defecto.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_clients_full_name_trgm
  ON public.clients USING gin (full_name extensions.gin_trgm_ops);
