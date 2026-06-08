-- Generaliza clients a contactos: flag is_client.
-- Los registros existentes son todos clientes, así que se marcan en true.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_client boolean NOT NULL DEFAULT false;

UPDATE public.clients SET is_client = true WHERE is_client = false;

COMMENT ON COLUMN public.clients.is_client IS
  'true = el contacto es cliente (datos comerciales + matching). false = contacto común.';
