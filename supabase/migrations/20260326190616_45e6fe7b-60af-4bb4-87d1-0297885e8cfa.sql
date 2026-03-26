
-- Create role enum
CREATE TYPE public.app_role AS ENUM ('super_admin', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- No public access
CREATE POLICY "No public access to user_roles" ON public.user_roles FOR ALL TO public USING (false) WITH CHECK (false);

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- Insert Nacho Poletti as super_admin
INSERT INTO public.user_roles (user_id, role)
VALUES ('e4269c23-d3dc-4dd9-afbd-4416734dbbff', 'super_admin');
