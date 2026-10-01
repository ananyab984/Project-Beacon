-- CreateEnum
CREATE TYPE "OnHoldReason" AS ENUM ('MANUAL', 'TIMEOUT', 'SYSTEM_ERROR');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "on_hold_reason" "OnHoldReason";
