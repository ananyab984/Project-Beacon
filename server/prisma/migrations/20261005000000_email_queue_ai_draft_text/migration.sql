-- AlterTable
-- Additive and nullable: no existing row changes, no backfill, safe on a live
-- database. Holds the AI draft exactly as generated so the AI-draft edit
-- rate can compare it with what was actually sent (body is overwritten by
-- every autosave, so without this the original draft is lost). Items drafted
-- before this column existed stay NULL and are left out of the metric.
ALTER TABLE "email_queue_items" ADD COLUMN "ai_draft_text" TEXT;
