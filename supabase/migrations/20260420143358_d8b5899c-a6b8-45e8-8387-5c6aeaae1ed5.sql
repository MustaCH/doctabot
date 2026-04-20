-- Agregar metadatos de dispositivo a push_subscriptions para auditar duplicados
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT,
  ADD COLUMN IF NOT EXISTS is_standalone BOOLEAN,
  ADD COLUMN IF NOT EXISTS device_label TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON public.push_subscriptions (user_id);

-- Limpiar suscripciones obsoletas registradas antes de unificar el service worker
-- (cualquier sub que no haya sido actualizada con metadatos nuevos será re-creada por el cliente)
DELETE FROM public.push_subscriptions
WHERE user_agent IS NULL;