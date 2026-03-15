
-- Table for important client dates (birthdays, purchase anniversaries, etc.)
CREATE TABLE public.client_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'birthday',
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'yearly',
  google_event_id TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.client_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own client_events" ON public.client_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own client_events" ON public.client_events FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own client_events" ON public.client_events FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own client_events" ON public.client_events FOR DELETE USING (user_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_client_events_updated_at
  BEFORE UPDATE ON public.client_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
