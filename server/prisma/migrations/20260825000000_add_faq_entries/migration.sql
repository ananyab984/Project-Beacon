-- CreateTable
CREATE TABLE "faq_entries" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faq_entries_is_active_idx" ON "faq_entries"("is_active");

-- CreateExtension and add full-text search support
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "faq_entries"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("question", '') || ' ' || coalesce("answer", ''))) STORED;

CREATE INDEX "faq_entries_search_idx" ON "faq_entries" USING GIN ("search_vector");
CREATE INDEX "faq_entries_question_trgm_idx" ON "faq_entries" USING GIN ("question" gin_trgm_ops);
