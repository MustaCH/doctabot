
-- Properties table (populated by scraping)
CREATE TABLE public.properties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id TEXT UNIQUE,
  title TEXT,
  operation TEXT,
  price NUMERIC,
  currency TEXT,
  address TEXT,
  locality TEXT,
  lat NUMERIC,
  lng NUMERIC,
  brokers TEXT,
  contact_person TEXT,
  office TEXT,
  dimensions_land_m2 NUMERIC,
  m2_total NUMERIC,
  m2_cover NUMERIC,
  ambientes INTEGER,
  banos INTEGER,
  property_type TEXT,
  url TEXT,
  photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversations table
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Nueva conversación',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages table
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Favorites table
CREATE TABLE public.favorites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, property_id)
);

-- Indexes
CREATE INDEX idx_properties_external_id ON public.properties(external_id);
CREATE INDEX idx_properties_locality ON public.properties(locality);
CREATE INDEX idx_properties_operation ON public.properties(operation);
CREATE INDEX idx_properties_property_type ON public.properties(property_type);
CREATE INDEX idx_properties_price ON public.properties(price);
CREATE INDEX idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX idx_favorites_user_id ON public.favorites(user_id);

-- Enable RLS
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- Helper function: check if user owns a conversation
CREATE OR REPLACE FUNCTION public.is_conversation_owner(conv_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations WHERE id = conv_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Properties: authenticated users can read
CREATE POLICY "Authenticated users can read properties"
  ON public.properties FOR SELECT
  TO authenticated
  USING (true);

-- Properties: service role can insert/update (for scraping edge function)
CREATE POLICY "Service role can manage properties"
  ON public.properties FOR ALL
  USING (true)
  WITH CHECK (true);

-- Conversations: users can CRUD their own
CREATE POLICY "Users can read own conversations"
  ON public.conversations FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own conversations"
  ON public.conversations FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own conversations"
  ON public.conversations FOR DELETE
  USING (user_id = auth.uid());

-- Messages: users can read/insert in their own conversations
CREATE POLICY "Users can read messages in own conversations"
  ON public.messages FOR SELECT
  USING (public.is_conversation_owner(conversation_id));

CREATE POLICY "Users can insert messages in own conversations"
  ON public.messages FOR INSERT
  WITH CHECK (public.is_conversation_owner(conversation_id));

-- Favorites: users can manage their own
CREATE POLICY "Users can read own favorites"
  ON public.favorites FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own favorites"
  ON public.favorites FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own favorites"
  ON public.favorites FOR DELETE
  USING (user_id = auth.uid());

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_properties_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
