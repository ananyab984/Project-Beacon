/** One-off backfill: reformats Tools_Software / Vendor_Experience for leads
 *  that are ALREADY enriched, using only text already on the row (Headline,
 *  Current_Title, About_Snippet, Certifications, Services) plus every
 *  structured/semi-structured section BrightData/Parallel actually returned
 *  (experience per-role title/summary, certifications, courses, via
 *  mergeProfileSections) -- no BrightData/Tavily/Parallel re-scrape, unlike
 *  backfill-enrichment.ts.
 *
 *  Purely deterministic (no LLM call): mirrors
 *  enrichment_pipeline/parsers/tool_aliases.py's extract_tools_from_text and
 *  vendor_aliases.py's extract_vendors_from_text/canonicalize_or_keep,
 *  ported to Node so this can run directly against Prisma. An earlier
 *  version of this script called Groq for the free-text classification --
 *  removed after it hit Groq's per-minute rate limit, then a hard daily
 *  token quota, mid-backfill, and twice hallucinated wrong data
 *  (universities/certification bodies reported as vendor experience, a
 *  vague phrase reported as a company name) on exactly the thin-text
 *  profiles where deterministic matching alone finds the least. The
 *  structured/narrative sections this version now scans cover the real
 *  gap Groq was patching over (a tool/vendor named only in a per-role
 *  description, not the thin Headline/About fields), with none of that
 *  cost or risk.
 *
 *  Merges (union, dedupes, canonicalizes) with whatever's already stored --
 *  never drops an existing value unless REPLACE_VENDORS=1 (see below).
 *
 *  Run: cd server && npx ts-node scripts/reformat-tools-vendor.ts
 */
import { prisma } from "../src/prisma";
import { normalizeToolsSoftware, matchToolsInText } from "../src/lib/normalizeToolsSoftware";
import { canonicalizeVendorToken, matchVendorsInText } from "../src/lib/normalizeVendorExperience";
import { mergeProfileSections, type SectionEntry } from "../src/lib/profileSections";

function arraysDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.some((v, i) => v !== sb[i]);
}

/** Every real narrative/title string a section entry carries beyond its
 *  `company`/short label -- title, summary (BrightData's description(_html)
 *  already normalized into this by mergeProfileSections), and subtitle
 *  (a certification's issuing platform, a course code -- can itself name a
 *  tool, e.g. "Ooona Certified Subtitler"). */
function entryText(e: SectionEntry): string {
  return [e.title, e.summary, e.subtitle].filter((v) => typeof v === "string" && v).join(" ");
}

async function main() {
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
  const leads = await prisma.lead.findMany({
    where: { profileLink: { not: null }, deletedAt: null },
    ...(limit ? { take: limit } : {}),
    select: {
      id: true,
      fullName: true,
      displayName: true,
      headline: true,
      currentTitle: true,
      aboutSnippet: true,
      certifications: true,
      services: true,
      toolsSoftware: true,
      vendorExperience: true,
      rawScrapeData: true,
      parallelData: true,
    },
  });
  console.log(`Found ${leads.length} leads with a profile link to reformat.\n`);

  let updated = 0;
  let skipped = 0;

  for (const lead of leads) {
    const name = lead.displayName || lead.fullName || lead.id;

    // Every distinct employer from the profile's STRUCTURED experience
    // history (rawScrapeData/parallelData, merged the same way the
    // Enrichment Details dialog's "Additional profile data found" section
    // does) -- confirmed live these company names (Netflix, Kinotitles Srls,
    // Baburka Production, ...) live here, not in Headline/About prose.
    const sections = mergeProfileSections(lead);
    const experienceCompanies = sections.experience
      .map((e) => (typeof e.company === "string" ? e.company : ""))
      .filter(Boolean);

    // Every real narrative/title string across experience, certifications,
    // and courses -- this is what catches a tool/vendor named only in a
    // per-role description ("used Pro Tools daily") or a certification title
    // ("Ooona Certified Subtitler"), not just the thin Headline/About text.
    const narrativeText = [...sections.experience, ...sections.certifications, ...sections.courses]
      .map(entryText)
      .join(" ");

    const textBlob = [lead.headline, lead.currentTitle, lead.aboutSnippet, lead.certifications.join(", "), lead.services.join(", "), narrativeText]
      .filter(Boolean)
      .join(" | ");

    if (!textBlob.trim() && experienceCompanies.length === 0) {
      console.log(`Skipping ${name} (${lead.id}): no text to read.`);
      skipped++;
      continue;
    }

    const matchedTools = textBlob.trim() ? matchToolsInText(textBlob) : [];
    const matchedVendors = textBlob.trim() ? matchVendorsInText(textBlob) : [];

    const mergedTools = normalizeToolsSoftware([...lead.toolsSoftware, ...matchedTools]);
    // REPLACE_VENDORS=1 recomputes Vendor_Experience purely from source
    // (structured experience + prose match), dropping whatever's already
    // stored, instead of the normal union-with-existing merge -- a one-time
    // corrective pass for data already corrupted by an earlier version of
    // this script's comma-splitting bug (real company names like
    // "Brindauto Comptoir, SA" got shredded into "Brindauto Comptoir" +
    // "SA" as two separate stored array entries; a plain union would keep
    // those stale fragments forever alongside the now-correctly-extracted
    // full name). Safe to do here since this field is purely enrichment-
    // derived, not a value a recruiter hand-typed.
    const vendorSources = process.env.REPLACE_VENDORS
      ? [...experienceCompanies, ...matchedVendors]
      : [...lead.vendorExperience, ...experienceCompanies, ...matchedVendors];
    const mergedVendors = Array.from(
      new Set(vendorSources.map(canonicalizeVendorToken).filter((v): v is string => v !== null))
    );

    const toolsChanged = arraysDiffer(mergedTools, lead.toolsSoftware);
    const vendorsChanged = arraysDiffer(mergedVendors, lead.vendorExperience);

    if (!toolsChanged && !vendorsChanged) {
      console.log(`${name} (${lead.id}): unchanged. tools=${JSON.stringify(mergedTools)} vendors=${JSON.stringify(mergedVendors)}`);
      skipped++;
      continue;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...(toolsChanged ? { toolsSoftware: mergedTools } : {}),
        ...(vendorsChanged ? { vendorExperience: mergedVendors } : {}),
      },
    });
    console.log(`${name} (${lead.id}): updated. tools=${JSON.stringify(mergedTools)} vendors=${JSON.stringify(mergedVendors)}`);
    updated++;
  }

  console.log(`\nDone. updated=${updated} skipped=${skipped} total=${leads.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
