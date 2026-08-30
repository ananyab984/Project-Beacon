-- Adds the persisted recipient address for an email queue item, distinct
-- from lead.email (which can drift after enrichment corrects it or a
-- recruiter overrides the target address before sending).
ALTER TABLE "email_queue_items" ADD COLUMN "to_email" TEXT;
