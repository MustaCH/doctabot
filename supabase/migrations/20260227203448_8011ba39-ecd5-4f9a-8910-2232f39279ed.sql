
-- Junction table: properties linked to clients
CREATE TABLE public.client_properties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'sugerida',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(client_id, property_id)
);

-- Enable RLS
ALTER TABLE public.client_properties ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can read own client_properties"
  ON public.client_properties FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own client_properties"
  ON public.client_properties FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own client_properties"
  ON public.client_properties FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own client_properties"
  ON public.client_properties FOR DELETE
  USING (user_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_client_properties_updated_at
  BEFORE UPDATE ON public.client_properties
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast lookups
CREATE INDEX idx_client_properties_client ON public.client_properties(client_id);
CREATE INDEX idx_client_properties_property ON public.client_properties(property_id);
