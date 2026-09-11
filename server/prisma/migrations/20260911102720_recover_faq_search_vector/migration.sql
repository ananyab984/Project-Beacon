-- Recovery migration: the original 20260825000000_add_faq_entries migration
-- is recorded in _prisma_migrations as successfully finished, but on at
-- least one environment (this dev database) the generated `search_vector`
-- column and its two indexes never actually existed on the live table --
-- confirmed via information_schema.columns / pg_indexes, root-caused while
-- investigating a bug report where FAQ full-text search silently found zero
-- matches for every query (a missing column referenced anywhere in a SQL
-- statement fails the whole statement at parse time, not just the branch
-- that references it -- so this also broke the trigram/tag-ILIKE fallbacks
-- in the same queries, not just the tsvector path).
--
-- search_vector isn't a Prisma-modeled field (tsvector has no native Prisma
-- type -- see FaqEntry in schema.prisma), so `prisma migrate status`/`db
-- push` can never detect this specific kind of drift; only re-running the
-- DDL can fix it. Written idempotently (IF NOT EXISTS throughout) so it's
-- safe to apply to an environment where the column already exists correctly
-- -- this recovers the broken environment without risk to a healthy one.

ALTER TABLE "faq_entries"
  ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("question", '') || ' ' || coalesce("answer", ''))) STORED;

CREATE INDEX IF NOT EXISTS "faq_entries_search_idx" ON "faq_entries" USING GIN ("search_vector");
CREATE INDEX IF NOT EXISTS "faq_entries_question_trgm_idx" ON "faq_entries" USING GIN ("question" gin_trgm_ops);
