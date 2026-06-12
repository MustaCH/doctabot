-- Rate limiting propio del chat (ticket 86aj0p5c0). Control de costo: cada turno dispara
-- Gemini Pro + Flash (+ retries + título). Limitamos N requests por usuario por ventana.
-- Estado en Postgres porque las edge functions son stateless (no sirve memoria local).
-- Idempotente.

create table if not exists public.chat_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  request_count integer not null default 0
);

alter table public.chat_rate_limits enable row level security;
-- Sin policies: solo el service_role (edge function) accede; bypassea RLS. Los usuarios no la leen.

-- Función atómica: registra el request y devuelve true si está dentro del límite.
-- Si la ventana expiró, la reinicia. SECURITY DEFINER para correr con privilegios del owner.
create or replace function public.check_chat_rate_limit(
  p_user_id uuid,
  p_max integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.chat_rate_limits as rl (user_id, window_start, request_count)
  values (p_user_id, now(), 1)
  on conflict (user_id) do update
    set
      window_start = case
        when rl.window_start < now() - make_interval(secs => p_window_seconds) then now()
        else rl.window_start end,
      request_count = case
        when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1
        else rl.request_count + 1 end
  returning request_count into v_count;

  return v_count <= p_max;
end;
$$;
