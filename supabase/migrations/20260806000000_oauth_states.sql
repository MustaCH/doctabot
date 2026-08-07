-- Nonces de un solo uso para el flujo OAuth de Google (google-calendar-auth).
-- Cada `state` firmado incluye un nonce que se inserta acá al iniciar el flujo
-- y se consume (DELETE ... RETURNING) en el callback. Un state reusado o
-- vencido no encuentra fila y se rechaza.
--
-- Seguridad: la tabla la toca únicamente el service_role desde la edge
-- function. RLS habilitado SIN policies = deny-by-default para anon y
-- authenticated (service_role bypassea RLS).

create table public.oauth_states (
  nonce uuid primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table public.oauth_states is
  'Nonces one-shot con TTL para el state firmado del OAuth de Google. Solo service_role.';

-- Para la limpieza periódica de nonces vencidos.
create index oauth_states_expires_at_idx on public.oauth_states (expires_at);

alter table public.oauth_states enable row level security;

-- Sin policies: nadie salvo service_role puede operar sobre la tabla.
-- Defensa en profundidad: revocamos también los grants por defecto.
revoke all on table public.oauth_states from anon, authenticated;
