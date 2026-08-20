-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "headline" TEXT,
ADD COLUMN     "about_snippet" TEXT,
ADD COLUMN     "current_title" TEXT,
ADD COLUMN     "tools_software" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[];
