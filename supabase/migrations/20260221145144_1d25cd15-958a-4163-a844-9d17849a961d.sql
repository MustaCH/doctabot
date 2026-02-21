-- Add a restrictive SELECT policy to invitation_codes that blocks all direct access.
-- The validate_invitation_code SECURITY DEFINER function bypasses RLS, so validation still works.
CREATE POLICY "No direct access to invitation codes"
  ON public.invitation_codes
  FOR SELECT
  USING (false);

-- Also block INSERT/UPDATE/DELETE for all users
CREATE POLICY "No direct insert to invitation codes"
  ON public.invitation_codes
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "No direct update to invitation codes"
  ON public.invitation_codes
  FOR UPDATE
  USING (false);

CREATE POLICY "No direct delete from invitation codes"
  ON public.invitation_codes
  FOR DELETE
  USING (false);