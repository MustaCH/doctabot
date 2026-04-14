
CREATE TABLE public.notified_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id, property_id)
);

ALTER TABLE public.notified_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notified_matches"
  ON public.notified_matches FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own notified_matches"
  ON public.notified_matches FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_notified_matches_lookup
  ON public.notified_matches (user_id, client_id, property_id);
