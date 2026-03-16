
ALTER TABLE public.clients ALTER COLUMN status SET DEFAULT 'hot';

UPDATE public.clients SET status = 'hot' WHERE status IN ('prospect', 'active');
UPDATE public.clients SET status = 'cold' WHERE status IN ('inactive', 'closed');
