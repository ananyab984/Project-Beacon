/*
  Warnings:

  - You are about to drop the column `client_name` on the `client_demand` table. All the data in the column will be lost.
  - Added the required column `client_id` to the `client_demand` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('UNASSIGNED', 'ACTIVE', 'PAUSED', 'FULFILLED');

-- AlterTable
ALTER TABLE "client_demand" DROP COLUMN "client_name",
ADD COLUMN     "client_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "escalations" ADD COLUMN     "client_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "region" TEXT,
    "project_name" TEXT,
    "headcount_needed" INTEGER NOT NULL,
    "filled" INTEGER NOT NULL DEFAULT 0,
    "gap" INTEGER NOT NULL DEFAULT 0,
    "priority" "ClientDemandPriority" NOT NULL DEFAULT 'STANDARD',
    "status" "RequirementStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "recruiter_id" TEXT,
    "deadline" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_assignments" (
    "id" TEXT NOT NULL,
    "requirement_id" TEXT NOT NULL,
    "recruiter_id" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_id" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "requirement_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_name_key" ON "clients"("name");

-- CreateIndex
CREATE INDEX "requirements_client_id_idx" ON "requirements"("client_id");

-- CreateIndex
CREATE INDEX "requirements_status_idx" ON "requirements"("status");

-- CreateIndex
CREATE INDEX "requirement_assignments_requirement_id_idx" ON "requirement_assignments"("requirement_id");

-- CreateIndex
CREATE INDEX "client_demand_client_id_idx" ON "client_demand"("client_id");

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_assignments" ADD CONSTRAINT "requirement_assignments_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_assignments" ADD CONSTRAINT "requirement_assignments_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_assignments" ADD CONSTRAINT "requirement_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_demand" ADD CONSTRAINT "client_demand_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
