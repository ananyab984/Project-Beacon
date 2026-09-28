/** One-off backfill: reformats Tools_Software / Vendor_Experience for leads
 *  that are ALREADY enriched, using only text already on the row (Headline,
 *  Current_Title, About_Snippet, Certifications, Services) -- no BrightData/
 *  Tavily/Parallel re-scrape, unlike backfill-enrichment.ts. Mirrors
 *  enrichment_pipeline/orchestrator.py's Stage 3.77
 *  (_infer_tools_vendor_via_llm / GroqMappingClient.classify_tools_and_vendors)
 *  ported to Node so this can run directly against Prisma without adding a
 *  Postgres driver to the Python service or a new FastAPI endpoint.
 *
 *  Merges (union, dedupes, canonicalizes) with whatever's already stored --
 *  never drops an existing value the Python pipeline already found.
 *
 *  Run: cd server && npx ts-node scripts/reformat-tools-vendor.ts
 */
import { prisma } from "../src/prisma";
import { loadDraftingConfig } from "../src/drafting/config";
import { GroqClient, GroqError } from "../src/drafting/groqClient";
import { normalizeToolsSoftware, STANDARD_TOOLS } from "../src/lib/normalizeToolsSoftware";
import { canonicalizeVendorToken, STANDARD_VENDORS } from "../src/lib/normalizeVendorExperience";
import { mergeProfileSections } from "../src/lib/profileSections";

function buildSystemPrompt(): string {
  const toolList = STANDARD_TOOLS.join(", ");
  const vendorList = STANDARD_VENDORS.join(", ");
  return (
    "You read a linguist/media-industry recruiting profile's already-extracted text " +
    "(which may include a headline, current title, about/bio, certifications, and a raw " +
    "skills/services list) and identify two things from it:\n\n" +
    `1. TOOLS_SOFTWARE: specific named software/tools the person uses professionally ` +
    `(subtitling software, translation/CAT tools, audio/video editing software, etc). ` +
    `These are the known canonical product names: ${toolList}. When the text names one ` +
    `of these (allowing for different phrasing, abbreviations, or a minor misspelling -- ` +
    `e.g. 'cut on Avid' means Avid Media Composer, 'Adobe's Premiere suite' means Adobe ` +
    `Premiere Pro), report it using EXACTLY the canonical spelling above. If the text ` +
    `clearly names a real, specific tool that is NOT on this list, report it exactly as ` +
    `stated instead of dropping it -- never invent one that isn't actually mentioned.\n\n` +
    `2. VENDOR_EXPERIENCE: every real, specific company, studio, or client this person has ` +
    `worked for or with, as named anywhere in the text (headline, current title, about, ` +
    `experience/work history) -- this means ANY named employer, not only major industry ` +
    `vendors. When a company matches (or is an obvious variant of) one of these well-known ` +
    `industry vendors, report it using its exact canonical spelling: ${vendorList} (e.g. 'SDI ` +
    `Media' or 'Iyuno-SDI' -> 'SDI'). Otherwise report the company name exactly as stated. Do ` +
    `NOT report a generic employment-status word (e.g. 'Freelancer', 'Freelance', ` +
    `'Self-employed', 'Independent') or a vague, non-specific phrase (e.g. 'Different ` +
    `companies', 'Various clients') as if it were a company name -- these are not real company ` +
    `names. Do NOT report a university, school, or professional certification/membership body ` +
    `(e.g. a translators' institute, a chartered institute, a business school) as vendor ` +
    `experience -- those are education or certification, not an employer or client.\n\n` +
    "RULES:\n" +
    "- Only report something the text directly states -- never infer or guess from vague context.\n" +
    "- Return SHORT canonical/company names, not full sentences or descriptions.\n" +
    "- Return an empty list for a category if nothing in the text supports it.\n\n" +
    'Respond with ONLY a JSON object of exactly this shape: ' +
    '{"tools_software": [<string>, ...], "vendor_experience": [<string>, ...]}'
  );
}

function arraysDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.some((v, i) => v !== sb[i]);
}

async function main() {
  const groq = new GroqClient(loadDraftingConfig());
  const systemPrompt = buildSystemPrompt();

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
  let failed = 0;

  for (const lead of leads) {
    const name = lead.displayName || lead.fullName || lead.id;
    const textBlob = [lead.headline, lead.currentTitle, lead.aboutSnippet, lead.certifications.join(", "), lead.services.join(", ")]
      .filter(Boolean)
      .join(" | ");

    // Every distinct employer from the profile's STRUCTURED experience
    // history (rawScrapeData/parallelData, merged the same way the
    // Enrichment Details dialog's "Additional profile data found" section
    // does) -- confirmed live these company names (Netflix, Kinotitles Srls,
    // Baburka Production, ...) live here, not in Headline/About prose, so a
    // profile with a rich Experience section but generic thin-field text
    // still needs this source, not just what Groq can read from textBlob.
    // canonicalizeVendorToken (below) handles canonicalizing/dropping these
    // the same as any other candidate value -- applied per-element, NOT via
    // normalizeVendorExperience's comma-splitting, since a real company name
    // here can legitimately contain a comma ("Brindauto Comptoir, SA").
    const sections = mergeProfileSections(lead);
    const experienceCompanies = sections.experience
      .map((e) => (typeof e.company === "string" ? e.company : ""))
      .filter(Boolean);

    if (!textBlob.trim() && experienceCompanies.length === 0) {
      console.log(`Skipping ${name} (${lead.id}): no text to read.`);
      skipped++;
      continue;
    }

    process.stdout.write(`Reformatting ${name} (${lead.id})... `);
    try {
      let groqTools: string[] = [];
      let groqVendors: string[] = [];

      if (textBlob.trim()) {
        const completion = await groq.chat(systemPrompt, "PROFILE TEXT:\n\n" + textBlob.slice(0, 6000), {
          jsonMode: true,
          temperature: 0,
          // Higher than a plain "list the answer" call needs -- confirmed
          // live this account hit "max completion tokens reached before
          // generating a valid document" at 512 (the model spends tokens
          // reasoning before it writes the closing JSON), not because the
          // real answer is long.
          maxTokens: 1024,
        });

        let parsed: { tools_software?: unknown; vendor_experience?: unknown };
        try {
          parsed = JSON.parse(completion.text);
        } catch {
          console.log(`SKIPPED: malformed JSON response`);
          skipped++;
          continue;
        }

        groqTools = Array.isArray(parsed.tools_software) ? parsed.tools_software.map(String) : [];
        groqVendors = Array.isArray(parsed.vendor_experience) ? parsed.vendor_experience.map(String) : [];
      }

      const mergedTools = normalizeToolsSoftware([...lead.toolsSoftware, ...groqTools]);
      const mergedVendors = Array.from(
        new Set(
          [...lead.vendorExperience, ...experienceCompanies, ...groqVendors]
            .map(canonicalizeVendorToken)
            .filter((v): v is string => v !== null)
        )
      );

      const toolsChanged = arraysDiffer(mergedTools, lead.toolsSoftware);
      const vendorsChanged = arraysDiffer(mergedVendors, lead.vendorExperience);

      if (!toolsChanged && !vendorsChanged) {
        console.log(`unchanged. tools=${JSON.stringify(mergedTools)} vendors=${JSON.stringify(mergedVendors)}`);
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
      console.log(`updated. tools=${JSON.stringify(mergedTools)} vendors=${JSON.stringify(mergedVendors)}`);
      updated++;
    } catch (err: any) {
      const message = err instanceof GroqError ? err.message : err?.message || err;
      console.log(`ERROR: ${message}`);
      failed++;
    }
    // This account's Groq tier caps at 8000 tokens/minute -- confirmed live
    // that 300ms (the normalizeServices-style "gentle" delay other backfill
    // scripts use) still hit 429s constantly and exhausted retries on 8 of
    // 93 leads. Each call here runs ~1000-1300 tokens total, so ~7-8s is the
    // actual sustainable pace at this tier, not a cosmetic slowdown.
    await new Promise((r) => setTimeout(r, 8000));
  }

  console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed} total=${leads.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
