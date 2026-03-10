CREATE TABLE public.supervisor_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  user_id uuid,
  user_message text NOT NULL,
  alan_response text NOT NULL,
  verdict text NOT NULL,
  rejection_reason text,
  score integer,
  retry_count integer DEFAULT 0,
  latency_ms integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.supervisor_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access to supervisor_logs" ON public.supervisor_logs
  FOR ALL TO public USING (false) WITH CHECK (false);