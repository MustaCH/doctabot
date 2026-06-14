-- Observabilidad: tabla central de error tracking (front + edge functions).
-- Ticket 86aj18r6x. Enfoque liviano sin SaaS externo: los errores se persisten acá
-- y, en paralelo, se pingea N8N_WEBHOOK_URL (canal que Nacho mira) — ver
-- supabase/functions/_shared/observability.ts y la edge fn report-error.
create table if not exists public.error_logs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,            -- 'frontend' | 'edge'
  context     text,                     -- nombre de la función / ruta / componente
  message     text not null,
  stack       text,
  metadata    jsonb,
  user_id     uuid,                     -- nullable: el front puede errorear pre-auth
  created_at  timestamptz not null default now()
);

-- Lectura/escaneo de health-monitor y queries de spike: siempre por ventana temporal.
create index if not exists idx_error_logs_created_at on public.error_logs (created_at desc);
create index if not exists idx_error_logs_source_created on public.error_logs (source, created_at desc);

-- RLS ON sin policies => solo el service_role (que bypasea RLS) escribe/lee.
-- El front NO inserta directo: pasa por la edge fn report-error (service role).
-- Es data de ops, no de usuario; se consulta desde el dashboard o admin tooling.
alter table public.error_logs enable row level security;

comment on table public.error_logs is
  'Error tracking liviano (front + edge). Escrito por service_role vía report-error / observability.ts. Ticket 86aj18r6x.';
