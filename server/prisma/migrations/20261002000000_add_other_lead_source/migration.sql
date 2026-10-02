-- AlterEnum
-- Additive only: no existing row changes value, so this needs no backfill and
-- is safe to apply to a live database. Rows already mislabelled LINKEDIN are
-- corrected separately (scripts/backfillLeadSource.ts), not by this migration.
ALTER TYPE "LeadSource" ADD VALUE 'OTHER';
