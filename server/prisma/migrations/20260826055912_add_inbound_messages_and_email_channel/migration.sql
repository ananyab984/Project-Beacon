-- CreateEnum
CREATE TYPE "InboundChannel" AS ENUM ('LINKEDIN', 'EMAIL');

-- AlterEnum
ALTER TYPE "ConversationChannel" ADD VALUE 'EMAIL';

-- CreateTable
CREATE TABLE "inbound_messages" (
    "id" TEXT NOT NULL,
    "unipile_message_id" TEXT NOT NULL,
    "channel" "InboundChannel" NOT NULL,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "sender" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_unipile_message_id_key" ON "inbound_messages"("unipile_message_id");

-- CreateIndex
CREATE INDEX "inbound_messages_account_id_idx" ON "inbound_messages"("account_id");

-- CreateIndex
CREATE INDEX "inbound_messages_thread_id_idx" ON "inbound_messages"("thread_id");
