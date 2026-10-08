-- "Check identity" (FLAGGED_REVIEW) is retired: a lead is either Enriched or On Hold.
-- The enum value stays in Postgres (dropping it means recreating the type); nothing writes it any more.
UPDATE "leads"
SET "enrichment_status" = 'COMPLETE',
    "identity_resolved" = ("email_address" IS NOT NULL OR "contact_number" IS NOT NULL) AND NOT ('ON_HOLD' = ANY("flags")),
    "promoted_to_global_at" = CASE
      WHEN ("email_address" IS NOT NULL OR "contact_number" IS NOT NULL) AND NOT ('ON_HOLD' = ANY("flags"))
      THEN COALESCE("promoted_to_global_at", now()) END
WHERE "enrichment_status" = 'FLAGGED_REVIEW';
