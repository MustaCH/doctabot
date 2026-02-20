
-- Create invitation_codes table
CREATE TABLE public.invitation_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.invitation_codes ENABLE ROW LEVEL SECURITY;

-- No direct client access — validation goes through a security definer function
-- Users cannot read the codes table directly

-- Security definer function to validate an invitation code
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
  );
$$;

-- Insert the initial invitation code for RE/MAX Docta
INSERT INTO public.invitation_codes (code) VALUES ('DOCTA1');
