
ALTER TABLE public.clients
  ADD COLUMN client_type text NOT NULL DEFAULT 'buyer',
  ADD COLUMN birthday date,
  ADD COLUMN company text,
  ADD COLUMN address text,
  ADD COLUMN preferred_zones text,
  ADD COLUMN budget_min numeric,
  ADD COLUMN budget_max numeric,
  ADD COLUMN property_type_interest text,
  ADD COLUMN source text,
  ADD COLUMN last_contact_at timestamptz;
