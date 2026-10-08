ALTER TABLE "leads" ADD COLUMN "enrichment_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "enrichment_retry_after" TIMESTAMP(3);
