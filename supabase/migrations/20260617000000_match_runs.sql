-- Observabilidad de morning-matches: una fila por corrida del job de matches proactivos.
-- Ticket 86aj1pgvb. El job ahora corre en lotes de usuarios auto-encadenados (selfInvoke,
-- como scrape-properties) para no exceder el worker limit (546). El éxito/fallo REAL de cada
-- corrida queda acá (no dependemos del "succeeded" del cron, que con pg_net async no refleja
-- el resultado de la función). El orchestrator crea la fila (status='running'); cada worker
-- incrementa los contadores; el último lote la finaliza (success | partial | error).
create table if not exists public.match_runs (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            text not null,            -- timestamp ISO de la corrida (idem batchTimestamp)
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,              -- null mientras status='running'
  users_total         int,                      -- usuarios con clientes al iniciar la corrida
  users_processed     int not null default 0,   -- usuarios efectivamente procesados (acumulado)
  user_errors         int not null default 0,   -- usuarios que fallaron su procesamiento (acumulado)
  buyer_match_groups  int not null default 0,   -- grupos de match comprador→propiedad creados (acumulado)
  seller_match_groups int not null default 0,   -- grupos de match vendedor→comprador creados (acumulado)
  properties_scanned  int,                      -- propiedades nuevas/actualizadas en 24h consideradas
  status              text not null default 'running', -- running | success | partial | error
  error_detail        text,                     -- primer error relevante, si hubo
  created_at          timestamptz not null default now()
);

-- Consulta típica: la última corrida / corridas por ventana temporal (health-monitor, spikes).
create index if not exists idx_match_runs_batch on public.match_runs (batch_id);
create index if not exists idx_match_runs_started on public.match_runs (started_at desc);

-- RLS ON sin policies => solo el service_role (que bypasea RLS) escribe/lee. Es data de ops
-- (la escribe la edge fn morning-matches con service key), no de usuario. Mismo patrón que error_logs.
alter table public.match_runs enable row level security;

comment on table public.match_runs is
  'Observabilidad de morning-matches: una fila por corrida (lotes auto-encadenados). Escrita por service_role. Ticket 86aj1pgvb.';
