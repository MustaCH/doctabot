
CREATE TABLE public.scraping_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text NOT NULL,
  message text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  current_page integer,
  total_pages integer,
  properties_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- No RLS needed - only accessed via service role from edge functions and admin panel
ALTER TABLE public.scraping_logs ENABLE ROW LEVEL SECURITY;

-- Index for fast batch lookups
CREATE INDEX idx_scraping_logs_batch_id ON public.scraping_logs(batch_id);
CREATE INDEX idx_scraping_logs_created_at ON public.scraping_logs(created_at DESC);
