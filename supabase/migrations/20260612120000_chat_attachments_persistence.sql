-- Persistencia de adjuntos y contexto multimodal del chat (ticket 86aj0p5bg).
-- Al recargar una conversación, Alan debe conservar imágenes, texto de PDF y citas
-- [REFERENCIA] de turnos anteriores. Para eso:
--   - messages.ai_content: contenido "para la IA" (PDF embebido + [REFERENCIA]) cuando
--     difiere del texto que se muestra (content).
--   - messages.attachments: refs a los adjuntos (imágenes en Storage, metadata de archivos).
--   - bucket privado chat-attachments con RLS por usuario (primer segmento del path = auth.uid()).
-- Idempotente: seguro de correr más de una vez (MCP + pipeline).

-- Columnas nuevas en messages
alter table public.messages add column if not exists ai_content text;
alter table public.messages add column if not exists attachments jsonb;

-- Bucket privado para adjuntos del chat
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

-- RLS de storage.objects: cada usuario solo accede a sus propios objetos.
-- El path es {auth.uid()}/{conversationId}/{uuid}.{ext} → foldername[1] = uid.
drop policy if exists "chat_attachments_select_own" on storage.objects;
create policy "chat_attachments_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "chat_attachments_insert_own" on storage.objects;
create policy "chat_attachments_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "chat_attachments_delete_own" on storage.objects;
create policy "chat_attachments_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
