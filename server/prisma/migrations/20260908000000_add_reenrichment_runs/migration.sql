-- CreateEnum
CREATE TYPE "ReenrichmentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'TIMED_OUT');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "autumn_data" JSONB;

-- CreateTable
CREATE TABLE "reenrichment_runs" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "status" "ReenrichmentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "autumn_task_id" TEXT,
    "requested_by_id" TEXT,
    "credits_used" INTEGER,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "reenrichment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reenrichment_runs_lead_id_started_at_idx" ON "reenrichment_runs"("lead_id", "started_at");

-- AddForeignKey
ALTER TABLE "reenrichment_runs" ADD CONSTRAINT "reenrichment_runs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
