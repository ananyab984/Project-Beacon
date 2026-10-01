-- DropIndex
DROP INDEX "conversation_messages_conversation_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "email_queue_items_lead_id_recruiter_id_key" ON "email_queue_items"("lead_id", "recruiter_id");

-- CreateIndex
CREATE INDEX "conversations_last_message_at_idx" ON "conversations"("last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_lead_id_recruiter_id_channel_key" ON "conversations"("lead_id", "recruiter_id", "channel");

-- CreateIndex
CREATE INDEX "conversation_messages_conversation_id_sender_sent_at_idx" ON "conversation_messages"("conversation_id", "sender", "sent_at");
