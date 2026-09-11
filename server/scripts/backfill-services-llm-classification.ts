/**
 * One-time backfill for leads that still have an empty services[] after
 * backfill-services-from-parallel.ts's keyword-alias pass, but do have
 * Headline/Current_Title/About_Snippet/Certifications text stored -- the
 * exact gap fixed going forward by enrichment_pipeline/orchestrator.py's
 * Stage 3.75 (_infer_services_via_llm / ClaudeClient.classify_services).
 *
 * parsers/service_aliases.py's fixed ~15-term keyword list only recognizes
 * localization-industry vocabulary (Dubbing, Subtitling, Translation...), so
 * a lead whose real service is phrased differently ("Audio Engineer at VSI /
 * Voice & Script International", "London-based audio engineer...") never
 * matched it, however plainly the text stated the person's actual
 * specialty. This applies the same LLM classification retroactively,
 * reusing the server's own ClaudeClient (src/drafting/claudeClient.ts) --
 * no Python involved, no new scrape/Parallel calls, just a read of text
 * already sitting in Postgres.
 *
 * Same rule as Stage 3.75: never touches a lead whose services isn't
 * genuinely empty, or whose fieldSources.Services is "manual"; tags the
 * field "llm_fallback" on write, exactly like a fresh Stage 3.75 pass would.
 *
 * Run: cd server && npx ts-node scripts/backfill-services-llm-classification.ts
 */
import { prisma } from "../src/prisma";
import { ClaudeClient } from "../src/drafting/claudeClient";
import { loadDraftingConfig } from "../src/drafting/config";

const SYSTEM_PROMPT = `You read a linguist/media-industry recruiting profile's already-extracted text and identify the real professional SERVICE(S) or SPECIALTY this person actually performs or offers -- e.g. Dubbing, Subtitling, Voice-over, Translation, Audio Engineering, Sound Design, Voice Direction, Casting, Video Editing, ADR, Localization, Interpretation, Copywriting, Project Management, or anything else a real profile could state. This is NOT limited to a fixed list -- report whatever the text actually supports, as short, concise service-category names (2-4 words each).

RULES:
- Only report a service the text directly supports (a stated job title, a described specialty, or explicit skills) -- never infer one from an employer's industry alone.
- A title that MANAGES or RECRUITS FOR a specialty is not the same as PERFORMING it: 'Localization Recruiter' or 'Dubbing Project Manager' do not mean the person dubs or localizes content themselves -- report a service only when the text shows the person does the work, not merely coordinates or hires for it. When genuinely ambiguous, prefer returning nothing over guessing.
- Return SHORT names, not full sentences (e.g. 'Audio Engineering', not 'an audio engineer with 10 years of experience').
- Return an EMPTY LIST if nothing in the text clearly supports a specific service -- never a placeholder, and never a guess from vague context alone (e.g. 'Business Owner' or 'Operations' do not name a real service on their own).

Respond with ONLY a JSON object of exactly this shape: {"services": [<string>, ...]}`;

async function classifyServices(claude: ClaudeClient, textBlob: string): Promise<string[]> {
  const result = await claude.chat(SYSTEM_PROMPT, `PROFILE TEXT:\n\n${textBlob.slice(0, 6000)}`, {
    jsonMode: true,
    temperature: 0,
    maxTokens: 512,
  });
  const parsed = JSON.parse(result.text);
  const services = parsed?.services;
  if (!Array.isArray(services)) return [];
  return services.map((s: unknown) => String(s).trim()).filter(Boolean);
}

async function main() {
  const claude = new ClaudeClient(loadDraftingConfig());

  const candidates = await prisma.lead.findMany({
    where: { services: { equals: [] } },
    select: {
      id: true, fullName: true, displayName: true, headline: true, currentTitle: true,
      aboutSnippet: true, certifications: true, fieldSources: true,
    },
  });

  let updated = 0;
  let skippedManual = 0;
  let skippedNoText = 0;
  let skippedNoGroundableService = 0;

  for (const lead of candidates) {
    const fieldSources = (lead.fieldSources as Record<string, string> | null) ?? {};
    if (fieldSources["Services"] === "manual") {
      skippedManual++;
      continue;
    }

    const textBlob = [lead.headline, lead.currentTitle, lead.aboutSnippet, lead.certifications]
      .filter((v) => v !== null && v !== undefined && v !== "")
      .join(" | ");
    if (!textBlob) {
      skippedNoText++;
      continue;
    }

    let services: string[];
    try {
      services = await classifyServices(claude, textBlob);
    } catch (err: any) {
      console.error(`Classification failed for ${lead.displayName ?? lead.fullName} (${lead.id}): ${err?.message ?? err}`);
      continue;
    }

    if (services.length === 0) {
      skippedNoGroundableService++;
      continue;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        services,
        fieldSources: { ...fieldSources, Services: "llm_fallback" } as any,
      },
    });
    updated++;
    console.log(`Updated ${lead.displayName ?? lead.fullName} (${lead.id}): Services = ${services.join(", ")}`);
  }

  console.log(
    `\n${updated} lead(s) updated, ${skippedManual} skipped (manual Services), ${skippedNoText} skipped (no text), ` +
      `${skippedNoGroundableService} skipped (no groundable service)`
  );
  await prisma.$disconnect();
}
main();
