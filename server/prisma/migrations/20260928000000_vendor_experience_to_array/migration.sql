-- Converts leads.vendor_experience from a single free-text string to a
-- canonical multi-value array (same shape as services / tools_software),
-- so Vendor Experience can hold multiple enriched values instead of one
-- comma-joined string blob. Existing comma-separated values are split into
-- array elements rather than dropped.
ALTER TABLE "leads"
  ALTER COLUMN "vendor_experience" DROP DEFAULT,
  ALTER COLUMN "vendor_experience" TYPE TEXT[] USING (
    CASE
      WHEN "vendor_experience" IS NULL OR btrim("vendor_experience") = '' THEN ARRAY[]::TEXT[]
      ELSE regexp_split_to_array(btrim("vendor_experience"), '\s*,\s*')
    END
  ),
  ALTER COLUMN "vendor_experience" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "vendor_experience" SET NOT NULL;
