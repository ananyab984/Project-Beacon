-- AlterTable
-- error_message only ever held failures, but a concluded run also has
-- something worth telling the recruiter on success ("kept your manual
-- values for X"), so the column becomes a general outcome message.
ALTER TABLE "reenrichment_runs" RENAME COLUMN "error_message" TO "message";
ALTER TABLE "reenrichment_runs" ADD COLUMN "fields_written" INTEGER;
