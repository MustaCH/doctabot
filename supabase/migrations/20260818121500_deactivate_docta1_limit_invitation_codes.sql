-- Ticket 86aj9w5k9 — Desactivar DOCTA1 + acotar invitation_codes

-- 1) Columnas para acotar blast radius (NULL = sin límite, para códigos legacy)
ALTER TABLE public.invitation_codes
  ADD COLUMN IF NOT EXISTS max_uses integer,
  ADD COLUMN IF NOT EXISTS uses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- 2) Desactivar DOCTA1 (hardcodeado en texto plano en el historial público del repo)
UPDATE public.invitation_codes SET is_active = false WHERE UPPER(code) = 'DOCTA1';

-- 3) validate_invitation_code_v2: respeta expiración y tope de usos.
--    Expirado/agotado se reporta como 'inactive' (el front ya muestra "ya no está
--    vigente, pedile uno nuevo a tu broker" para ese estado — no hay que tocarlo).
--    Un código válido incrementa uses (el uso real es completar onboarding, pero
--    contar en la validación alcanza para acotar blast radius y es lo más simple).
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
    ELSIF matched_record.expires_at IS NOT NULL AND matched_record.expires_at < now() THEN
      result_status := 'inactive';
    ELSIF matched_record.max_uses IS NOT NULL AND matched_record.uses >= matched_record.max_uses THEN
      result_status := 'inactive';
    ELSE
      result_status := 'valid';
      UPDATE public.invitation_codes SET uses = uses + 1 WHERE id = matched_record.id;
    END IF;
  END IF;

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

-- 4) v1 (sin uso en el front, pero sigue expuesta): mismos límites, sin incrementar
CREATE OR REPLACE FUNCTION public.validate_invitation_code(input_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invitation_codes
    WHERE UPPER(code) = UPPER(TRIM(input_code))
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > now())
      AND (max_uses IS NULL OR uses < max_uses)
  );
$$;

-- El código nuevo NO va acá: se genera por fuera de git, directo en la DB
-- (INSERT ad-hoc con gen_random_uuid()/random(), max_uses y expires_at seteados).
