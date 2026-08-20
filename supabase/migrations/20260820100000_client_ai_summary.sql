-- Ticket 86aj9w5nu — memoria de cliente entre conversaciones (SQL aprobado por Nacho,
-- aplicado en prod el 2026-08-20 vía MCP como "client_ai_summary").
-- ai_summary: resumen de lo hablado/decidido con el cliente, regenerado post-turno por
-- gemini-2.5-flash cuando la conversación está vinculada (ver _shared/client-summary.ts).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_summary_updated_at timestamptz;
