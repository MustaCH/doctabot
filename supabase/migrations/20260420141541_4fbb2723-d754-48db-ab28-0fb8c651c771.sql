-- Tabla para registrar cada intento de envío de push
CREATE TABLE public.push_delivery_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  endpoint_preview TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'pruned')),
  http_status INTEGER,
  error_message TEXT,
  pruned BOOLEAN NOT NULL DEFAULT false,
  trigger_source TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS: solo super_admin puede leer; nadie escribe desde el cliente
ALTER TABLE public.push_delivery_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can read push delivery logs"
ON public.push_delivery_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));

-- Índices para queries del panel
CREATE INDEX idx_push_delivery_logs_created_at
  ON public.push_delivery_logs (created_at DESC);

CREATE INDEX idx_push_delivery_logs_status_created_at
  ON public.push_delivery_logs (status, created_at DESC);

-- Extender cleanup_old_logs para borrar registros viejos (>30 días)
CREATE OR REPLACE FUNCTION public.cleanup_old_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.supervisor_logs
  WHERE created_at < now() - INTERVAL '90 days';

  DELETE FROM public.scraping_logs
  WHERE created_at < now() - INTERVAL '30 days';

  DELETE FROM public.client_activity_log
  WHERE created_at < now() - INTERVAL '180 days';

  DELETE FROM public.push_delivery_logs
  WHERE created_at < now() - INTERVAL '30 days';
END;
$function$;