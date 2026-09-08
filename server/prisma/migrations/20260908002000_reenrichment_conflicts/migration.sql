-- AlterTable
-- Re-enrichment fills gaps rather than overwriting, so a populated field
-- where Autumn disagrees becomes a recruiter decision instead of a silent
-- write. These hold that decision until they make it.
ALTER TABLE "reenrichment_runs" ADD COLUMN "conflicts" JSONB;
ALTER TABLE "reenrichment_runs" ADD COLUMN "resolved_at" TIMESTAMP(3);
