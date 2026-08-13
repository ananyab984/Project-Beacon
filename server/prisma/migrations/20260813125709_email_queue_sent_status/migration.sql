-- AlterEnum
ALTER TYPE "EmailQueueStatus" ADD VALUE 'SENT';

-- AlterTable
ALTER TABLE "email_queue_items" ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "sent_channel" TEXT;
