
-- Drop the overly permissive policy and replace with role-specific ones
DROP POLICY "Service role can manage properties" ON public.properties;

-- The scraping edge function uses supabase service_role key which bypasses RLS entirely,
-- so we don't need an explicit policy for it. The SELECT policy for authenticated users is sufficient.
