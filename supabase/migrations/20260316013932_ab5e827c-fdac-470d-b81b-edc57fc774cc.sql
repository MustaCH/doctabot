
-- Activity log table
CREATE TABLE public.client_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action_type text NOT NULL,
  description text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own activity logs" ON public.client_activity_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own activity logs" ON public.client_activity_log
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own activity logs" ON public.client_activity_log
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Client notes table
CREATE TABLE public.client_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL,
  is_action boolean NOT NULL DEFAULT false,
  is_done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own client notes" ON public.client_notes
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own client notes" ON public.client_notes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own client notes" ON public.client_notes
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can delete own client notes" ON public.client_notes
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Index for fast lookups
CREATE INDEX idx_activity_log_client ON public.client_activity_log(client_id);
CREATE INDEX idx_client_notes_client ON public.client_notes(client_id);
