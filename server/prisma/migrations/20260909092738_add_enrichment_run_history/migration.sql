-- CreateEnum
CREATE TYPE "EnrichmentRunConclusion" AS ENUM ('SHORT_CIRCUIT_SUCCESS', 'EXHAUSTED_NO_MATCH', 'TIMED_OUT', 'SYSTEM_ERROR');

-- CreateEnum
CREATE TYPE "EnrichmentTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "last_manual_override_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "enrichment_runs" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "platform" "LeadSource" NOT NULL,
    "conclusion" "EnrichmentRunConclusion" NOT NULL,
    "tier" "EnrichmentTier",
    "enriched_field_count" INTEGER NOT NULL,
    "execution_time_ms" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "concluded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrichment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrichment_runs_platform_concluded_at_idx" ON "enrichment_runs"("platform", "concluded_at");

-- CreateIndex
CREATE INDEX "enrichment_runs_lead_id_started_at_idx" ON "enrichment_runs"("lead_id", "started_at");

-- AddForeignKey
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

