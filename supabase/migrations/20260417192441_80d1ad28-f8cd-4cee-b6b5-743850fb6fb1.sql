-- Explicit deny-all RLS policy on scraping_logs
-- Service role bypasses RLS, so only edge functions can access these logs
DROP POLICY IF EXISTS "No public access to scraping_logs" ON public.scraping_logs;

CREATE POLICY "No public access to scraping_logs"
ON public.scraping_logs
AS PERMISSIVE
FOR ALL
TO public
USING (false)
WITH CHECK (false);