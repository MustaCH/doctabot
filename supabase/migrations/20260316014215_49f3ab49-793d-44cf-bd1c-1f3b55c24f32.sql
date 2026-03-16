
-- Tags table
CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3b82f6',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tags" ON public.tags
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own tags" ON public.tags
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own tags" ON public.tags
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can delete own tags" ON public.tags
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Client-tag junction table
CREATE TABLE public.client_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, tag_id)
);

ALTER TABLE public.client_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own client_tags" ON public.client_tags
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tags WHERE id = tag_id AND user_id = auth.uid())
  );
CREATE POLICY "Users can insert own client_tags" ON public.client_tags
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.tags WHERE id = tag_id AND user_id = auth.uid())
  );
CREATE POLICY "Users can delete own client_tags" ON public.client_tags
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tags WHERE id = tag_id AND user_id = auth.uid())
  );

CREATE INDEX idx_client_tags_client ON public.client_tags(client_id);
CREATE INDEX idx_client_tags_tag ON public.client_tags(tag_id);
