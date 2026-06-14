-- Fix: push notifications nunca se mostraban (201 del push service pero el SW no
-- mostraba nada). Causa raíz: push_subscriptions tenía RLS para DELETE/INSERT/SELECT
-- pero NO para UPDATE. El front hace upsert(..., {onConflict:"endpoint"}); al re-activar
-- notificaciones con el mismo endpoint, el upsert se vuelve UPDATE -> 403 -> la fila no
-- refresca p256dh/auth -> el server cifra con keys viejas -> el navegador no puede
-- descifrar el payload -> el push se entrega (201) pero el SW falla y no muestra nada.
-- Ver docs/infra.md y bug ClickUp 86aj18u6f.

drop policy if exists "Users can update own push subscriptions" on public.push_subscriptions;

create policy "Users can update own push subscriptions"
on public.push_subscriptions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
