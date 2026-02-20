
-- Create clients table
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  full_name text NOT NULL,
  phone text,
  email text,
  notes text,
  status text NOT NULL DEFAULT 'prospect',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- RLS policies for clients
CREATE POLICY "Users can create own clients"
  ON public.clients FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can read own clients"
  ON public.clients FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own clients"
  ON public.clients FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own clients"
  ON public.clients FOR DELETE
  USING (user_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add client_id and conversation_type to conversations
ALTER TABLE public.conversations
  ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN conversation_type text;
