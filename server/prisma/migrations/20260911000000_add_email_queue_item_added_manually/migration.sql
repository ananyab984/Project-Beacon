-- AlterTable
ALTER TABLE "email_queue_items" ADD COLUMN "added_manually" BOOLEAN NOT NULL DEFAULT true;
