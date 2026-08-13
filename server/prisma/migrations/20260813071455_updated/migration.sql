/*
  Warnings:

  - The values [REFERRAL,IMPORT,GITHUB] on the enum `LeadSource` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `availability_status` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `available_from` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `avatar_url` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `bio` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `blackout_dates` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `country_of_residence` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `headline` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `linkedin_url` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `notify_duplicate` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `notify_message` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `notify_new_lead` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `notify_weekly_digest` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `portfolio_url` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `preferred_contact` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `proz_url` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `rate_amount` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `rate_unit` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `resume_filename` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `resume_size_kb` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `secondary_languages` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `services` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `source_language` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `target_languages` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `timezone` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `two_fa_enabled` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `vendor_experience` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `website_url` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `weekly_capacity_hours` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `whatsapp` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `years_of_experience` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `user_flag_events` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[unipile_chat_id]` on the table `conversations` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('PERMANENT', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('CONNECTING', 'OK', 'RECONNECTION_NEEDED', 'PERMISSION_REVOKED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "UnipileProvider" AS ENUM ('LINKEDIN', 'GOOGLE', 'MAIL', 'OUTLOOK', 'EMAIL');

-- AlterEnum
BEGIN;
CREATE TYPE "LeadSource_new" AS ENUM ('LINKEDIN', 'PROZ', 'ADA', 'ATA', 'ATAA', 'BODALGO', 'FREELANCER', 'APOLLO');
ALTER TABLE "leads" ALTER COLUMN "source" TYPE "LeadSource_new" USING ("source"::text::"LeadSource_new");
ALTER TYPE "LeadSource" RENAME TO "LeadSource_old";
ALTER TYPE "LeadSource_new" RENAME TO "LeadSource";
DROP TYPE "LeadSource_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "user_flag_events" DROP CONSTRAINT "user_flag_events_confirmed_by_recruiter_id_fkey";

-- DropForeignKey
ALTER TABLE "user_flag_events" DROP CONSTRAINT "user_flag_events_set_by_recruiter_id_fkey";

-- DropForeignKey
ALTER TABLE "user_flag_events" DROP CONSTRAINT "user_flag_events_user_id_fkey";

-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN     "external_message_id" TEXT;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "unipile_chat_id" TEXT;

-- AlterTable
ALTER TABLE "interaction_events" ADD COLUMN     "external_message_id" TEXT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "availability_status",
DROP COLUMN "available_from",
DROP COLUMN "avatar_url",
DROP COLUMN "bio",
DROP COLUMN "blackout_dates",
DROP COLUMN "country_of_residence",
DROP COLUMN "currency",
DROP COLUMN "headline",
DROP COLUMN "linkedin_url",
DROP COLUMN "notify_duplicate",
DROP COLUMN "notify_message",
DROP COLUMN "notify_new_lead",
DROP COLUMN "notify_weekly_digest",
DROP COLUMN "phone",
DROP COLUMN "portfolio_url",
DROP COLUMN "preferred_contact",
DROP COLUMN "proz_url",
DROP COLUMN "rate_amount",
DROP COLUMN "rate_unit",
DROP COLUMN "resume_filename",
DROP COLUMN "resume_size_kb",
DROP COLUMN "secondary_languages",
DROP COLUMN "services",
DROP COLUMN "source_language",
DROP COLUMN "target_languages",
DROP COLUMN "timezone",
DROP COLUMN "two_fa_enabled",
DROP COLUMN "vendor_experience",
DROP COLUMN "website_url",
DROP COLUMN "weekly_capacity_hours",
DROP COLUMN "whatsapp",
DROP COLUMN "years_of_experience",
ADD COLUMN     "work_status" "WorkStatus" NOT NULL DEFAULT 'PERMANENT';

-- DropTable
DROP TABLE "user_flag_events";

-- DropEnum
DROP TYPE "Currency";

-- DropEnum
DROP TYPE "PreferredContact";

-- DropEnum
DROP TYPE "RateUnit";

-- DropEnum
DROP TYPE "UserFlagType";

-- CreateTable
CREATE TABLE "connected_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "UnipileProvider" NOT NULL,
    "unipile_account_id" TEXT NOT NULL,
    "account_name" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'CONNECTING',
    "status_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unipile_auth_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "UnipileProvider" NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unipile_auth_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unipile_webhook_events" (
    "id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unipile_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_degradations" (
    "id" TEXT NOT NULL,
    "connected_account_id" TEXT NOT NULL,
    "from_status" "AccountStatus" NOT NULL,
    "to_status" "AccountStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_degradations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connected_accounts_unipile_account_id_key" ON "connected_accounts"("unipile_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "connected_accounts_user_id_provider_key" ON "connected_accounts"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "unipile_auth_attempts_nonce_key" ON "unipile_auth_attempts"("nonce");

-- CreateIndex
CREATE INDEX "unipile_auth_attempts_user_id_idx" ON "unipile_auth_attempts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "unipile_webhook_events_dedupe_key_key" ON "unipile_webhook_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "conversation_messages_external_message_id_idx" ON "conversation_messages"("external_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_unipile_chat_id_key" ON "conversations"("unipile_chat_id");

-- CreateIndex
CREATE INDEX "interaction_events_external_message_id_idx" ON "interaction_events"("external_message_id");

-- AddForeignKey
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_degradations" ADD CONSTRAINT "account_degradations_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "connected_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
