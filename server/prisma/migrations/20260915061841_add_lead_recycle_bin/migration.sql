-- AlterTable
ALTER TABLE "leads" ADD COLUMN "deleted_at" TIMESTAMP(3),
ADD COLUMN "deleted_by_user_id" TEXT;

-- CreateIndex
CREATE INDEX "leads_deleted_at_idx" ON "leads"("deleted_at");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
