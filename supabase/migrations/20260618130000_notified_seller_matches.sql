-- Tracking de notificaciones seller→buyer.
--
-- La fase seller de morning-matches venía guardando los pares (seller, buyer) en
-- `notified_matches` con `property_id = buyer.id`. Pero `notified_matches.property_id`
-- tiene FK a `properties(id)`, y un id de cliente nunca existe ahí → PG 23503 en cada
-- match de vendedor. Consecuencias: error logueado en cada corrida + el dedup nunca
-- persistía, así que los vendedores se re-notificaban todos los días.
--
-- Solución (ver docs/adrs/0003): tabla dedicada con FKs correctas a `clients`.
-- `notified_matches` queda exclusivamente para matches buyer→propiedad.

CREATE TABLE public.notified_seller_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  seller_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  buyer_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, seller_client_id, buyer_client_id)
);

ALTER TABLE public.notified_seller_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notified_seller_matches"
  ON public.notified_seller_matches FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own notified_seller_matches"
  ON public.notified_seller_matches FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_notified_seller_matches_lookup
  ON public.notified_seller_matches (user_id, seller_client_id, buyer_client_id);

-- Para la fase de push, que filtra por ventana de la corrida.
CREATE INDEX idx_notified_seller_matches_created_at
  ON public.notified_seller_matches (created_at);
