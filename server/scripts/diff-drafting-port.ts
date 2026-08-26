/** Real-lead draft-diff for the drafting_service -> server/src/drafting port.
 * Builds lead records from real captured Clay payloads (Alex Anthraper, Avik
 * Chakraborty -- POC's/clay_poc/webhook_events.jsonl), runs them through the
 * new in-process orchestrator, and -- if the Python drafting_service is
 * still reachable on port 8001 -- also runs them through it for a baseline
 * comparison. Diffs groundingFacts() (deterministic, must match exactly)
 * and the evaluator's per-check pass/fail pattern (LLM text itself is
 * non-deterministic, so exact text equality isn't the bar).
 *
 * Run via: npx ts-node scripts/diff-drafting-port.ts */

import fs from "fs";
import path from "path";
import axios from "axios";
import { fromRecord } from "../src/drafting/leads";
import { loadDraftingConfig } from "../src/drafting/config";
import { DraftingOrchestrator } from "../src/drafting/orchestrator";

const RAW_PATH = path.join(__dirname, "__fixtures__", "clay-verify-leads.json");
const PYTHON_DRAFTING_URL = "http://127.0.0.1:8001";

interface RawCapture {
  linkedin_enrichment: Record<string, any>;
  contact_details: string | null;
  source_row_index: number;
}

// Mirrors clay.service.ts's mapClayEnrichment() so the reconstructed lead
// record matches what would actually be stored on the Lead row after this
// real webhook was processed.
function buildLeadRecord(raw: Record<string, any>, profileLink: string, testEmail?: string) {
  const firstOf = (keys: string[]) => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null) return raw[k];
    }
    return undefined;
  };
  return {
    First_Name: (raw.name || raw.first_name || "").split(" ")[0] || "there",
    Full_Name: raw.name,
    Country_of_Residence: raw.country || raw.location_name,
    Source: "LinkedIn",
    Profile_Link: profileLink,
    Email_Address: testEmail,
    Headline: raw.headline,
    Current_Title: raw.title,
    About_Snippet: raw.summary || raw.about,
    Clay_Experience: firstOf(["experience", "pastRoles"]),
    Clay_Education: firstOf(["education"]),
    Clay_Languages: firstOf(["languages"]),
    Clay_Courses: firstOf(["courses"]),
    Clay_Full_Data: raw,
  };
}

async function main() {
  const raw: Record<string, RawCapture> = JSON.parse(fs.readFileSync(RAW_PATH, "utf-8"));

  const leads = [
    { key: "avik", record: buildLeadRecord(raw.avik.linkedin_enrichment, `https://linkedin.com/in/${raw.avik.linkedin_enrichment.slug}`) },
    { key: "alex", record: buildLeadRecord(raw.alex.linkedin_enrichment, `https://linkedin.com/in/${raw.alex.linkedin_enrichment.slug}`) },
  ];

  const orchestrator = new DraftingOrchestrator(loadDraftingConfig());

  let pythonReachable = true;
  try {
    await axios.get(`${PYTHON_DRAFTING_URL}/health`, { timeout: 3000 });
  } catch {
    pythonReachable = false;
    console.log("Python drafting_service not reachable on :8001 -- skipping baseline comparison, running new port only.\n");
  }

  for (const { key, record } of leads) {
    console.log(`${"=".repeat(78)}\n${key.toUpperCase()}\n${"=".repeat(78)}`);

    // Deterministic groundingFacts() parity -- must match Python exactly.
    const lead = fromRecord(record);
    const tsFacts = lead.groundingFacts();
    console.log("groundingFacts() (TS):", JSON.stringify(tsFacts, null, 2));

    if (pythonReachable) {
      try {
        const pyResp = await axios.post(`${PYTHON_DRAFTING_URL}/draft`, { lead: record, channel: "linkedin" }, { timeout: 30000 });
        console.log("\n--- Python drafting_service (baseline) ---");
        console.log("verdict:", pyResp.data.verdict, "| checks:", pyResp.data.evaluation.checks.map((c: any) => `${c.name}=${c.passed}`).join(", "));
        console.log("body:", pyResp.data.body);
      } catch (err: any) {
        console.log("Python call failed:", err?.message || err);
      }
    }

    console.log("\n--- New in-process port ---");
    const tsResult = await orchestrator.processDraft(record, "linkedin");
    console.log("verdict:", tsResult.verdict, "| checks:", tsResult.evaluation.checks.map((c) => `${c.name}=${c.passed}`).join(", "));
    console.log("body:", tsResult.body);
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
