-- Ticket 86aj9w5pp — multimodal estructurado (SQL aprobado por Nacho, 2026-08-20).
-- Persistencia de análisis tipados de fotos de propiedad (analyze_property_media) y
-- documentos (extract_document). La visión la hace el modelo en el turno; la tool valida
-- el JSON contra su schema y lo guarda acá. Vinculación opcional a cliente/propiedad.
CREATE TABLE IF NOT EXISTS public.media_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('property_media', 'document')),
  doc_type text,
  source_label text,
  analysis jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_analyses_user_client_idx ON public.media_analyses (user_id, client_id);
CREATE INDEX IF NOT EXISTS media_analyses_user_created_idx ON public.media_analyses (user_id, created_at DESC);

-- Solo la leen/escriben las edge functions (service_role). RLS activado sin policies:
-- el anon/authenticated del front no accede hasta que exista una vista con policies propias.
ALTER TABLE public.media_analyses ENABLE ROW LEVEL SECURITY;
