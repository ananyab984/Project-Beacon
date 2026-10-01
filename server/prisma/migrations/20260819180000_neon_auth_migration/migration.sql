-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_fkey";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "password_hash",
DROP COLUMN "reset_token",
DROP COLUMN "reset_token_expires_at",
DROP COLUMN "verify_token",
DROP COLUMN "verify_token_expires_at",
ADD COLUMN     "neon_auth_user_id" TEXT;

-- DropTable
DROP TABLE "refresh_tokens";

-- CreateIndex
CREATE UNIQUE INDEX "users_neon_auth_user_id_key" ON "users"("neon_auth_user_id");
