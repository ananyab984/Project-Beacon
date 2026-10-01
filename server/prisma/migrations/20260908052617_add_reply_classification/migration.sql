-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "reply_categories" (
    "id" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reply_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reply_classification_events" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "category_id" TEXT,
    "confidence" NUMERIC(4,3),
    "source" "ClassificationSource" NOT NULL,
    "changed_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reply_classification_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reply_categories_name_key" ON "reply_categories"("name");

-- CreateIndex
CREATE INDEX "reply_categories_is_active_idx" ON "reply_categories"("is_active");

-- CreateIndex
CREATE INDEX "reply_classification_events_lead_id_idx" ON "reply_classification_events"("lead_id");

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "reply_category_id" TEXT,
ADD COLUMN "reply_classification_source" "ClassificationSource",
ADD COLUMN "reply_classified_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "reply_classification_events" ADD CONSTRAINT "reply_classification_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_classification_events" ADD CONSTRAINT "reply_classification_events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "reply_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_classification_events" ADD CONSTRAINT "reply_classification_events_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_reply_category_id_fkey" FOREIGN KEY ("reply_category_id") REFERENCES "reply_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
