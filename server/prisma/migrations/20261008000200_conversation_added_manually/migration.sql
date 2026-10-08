-- Threads auto-created on lead creation (since removed) with no messages were never chosen by the recruiter.
ALTER TABLE "conversations" ADD COLUMN "added_manually" BOOLEAN NOT NULL DEFAULT true;
UPDATE "conversations" c SET "added_manually" = false
WHERE NOT EXISTS (SELECT 1 FROM "conversation_messages" m WHERE m."conversation_id" = c."id");
