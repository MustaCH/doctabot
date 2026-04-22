-- Tabla de logging de intentos para debug
CREATE TABLE IF NOT EXISTS public.invitation_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  raw_input TEXT NOT NULL,
  normalized_input TEXT NOT NULL,
  raw_bytes TEXT NOT NULL,
  status TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.invitation_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can read invitation attempts"
ON public.invitation_attempts
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "No direct insert to invitation attempts"
ON public.invitation_attempts
FOR INSERT
WITH CHECK (false);

-- Nueva función con normalización agresiva y estado detallado
CREATE OR REPLACE FUNCTION public.validate_invitation_code_v2(input_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  normalized_input TEXT;
  matched_record RECORD;
  result_status TEXT;
BEGIN
  -- Normalizar agresivamente: solo A-Z y 0-9
  normalized_input := regexp_replace(UPPER(COALESCE(input_code, '')), '[^A-Z0-9]', '', 'g');

  IF normalized_input = '' THEN
    result_status := 'not_found';
  ELSE
    SELECT * INTO matched_record
    FROM public.invitation_codes
    WHERE regexp_replace(UPPER(code), '[^A-Z0-9]', '', 'g') = normalized_input
    LIMIT 1;

    IF matched_record IS NULL THEN
      result_status := 'not_found';
    ELSIF matched_record.is_active = false THEN
      result_status := 'inactive';
    ELSE
      result_status := 'valid';
    END IF;
  END IF;

  -- Loguear intento (solo si no es válido, para debug)
  IF result_status <> 'valid' THEN
    INSERT INTO public.invitation_attempts (raw_input, normalized_input, raw_bytes, status)
    VALUES (
      COALESCE(input_code, ''),
      normalized_input,
      encode(convert_to(COALESCE(input_code, ''), 'UTF8'), 'hex'),
      result_status
    );
  END IF;

  RETURN result_status;
END;
$$;