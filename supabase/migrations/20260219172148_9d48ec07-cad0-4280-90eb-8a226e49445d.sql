-- Change is_conversation_owner from SECURITY DEFINER to SECURITY INVOKER
-- This is safer as the function will respect RLS policies on the conversations table
CREATE OR REPLACE FUNCTION public.is_conversation_owner(conv_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations WHERE id = conv_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY INVOKER STABLE SET search_path = public;