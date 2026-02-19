CREATE POLICY "Users can delete messages in own conversations"
ON public.messages
FOR DELETE
USING (is_conversation_owner(conversation_id));