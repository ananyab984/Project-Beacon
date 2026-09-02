/** AI Message Drafting Pipeline Orchestrator — direct port of
 * drafting_service/orchestrator.py, called in-process from the two
 * generate-draft route handlers instead of over HTTP. */

import { randomBytes } from "crypto";
import type { DraftingConfig } from "./config";
import { ClaudeClient } from "./claudeClient";
import { Draft, generateEmail, generateLinkedin } from "./draftGenerator";
import { EditLogResult, logRecruiterEdit } from "./editLogger";
import { checkChannelEligibility, fromRecord } from "./leads";
import { Evaluation, evaluate } from "./evaluator";
import { RateCardRow, RateCardService } from "./rateCard";

export interface PipelineDraftResult {
  draft_id: string;
  channel: string;
  lead_name: string;
  subject: string | null;
  body: string;
  verdict: "SEND" | "HOLD" | "INELIGIBLE";
  evaluation: Evaluation;
  flags: string[];
  rate_applied: RateCardRow | null;
  telemetry: {
    model: string | null;
    latency_ms: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_execution_time_ms: number;
  };
  manual_override: boolean;
}

/** 6-Stage AI Message Drafting Pipeline Orchestrator. */
export class DraftingOrchestrator {
  private config: DraftingConfig;
  private client: ClaudeClient | null;
  private rateCardService: RateCardService;

  constructor(config: DraftingConfig, rateCard?: RateCardRow[] | null) {
    this.config = config;
    this.client = config.apiKey ? new ClaudeClient(config) : null;
    this.rateCardService = new RateCardService(rateCard);
  }

  async processDraft(
    leadRecord: Record<string, any>,
    channel: string = "email",
    manualOverride = false,
    // Our own database id for this lead -- kept as a separate top-level
    // parameter (like `channel`) rather than added to leadRecord/the Lead
    // class, which are a direct port of drafting_service's Python types and
    // never carried our id. Required (not optional) so a caller can't
    // silently omit it and fall back to the old static, unpersonalized
    // apply_url -- see ensureLinks() in draftGenerator.ts.
    leadId: string
  ): Promise<PipelineDraftResult> {
    const startTime = Date.now();
    const draftId = `draft_${randomBytes(4).toString("hex")}`;

    // Stage 1: Lead Ingestion
    const lead = fromRecord(leadRecord);

    // Stage 1.5: Automatic Eligibility Gate (bypassed entirely if manualOverride)
    const eligibility = checkChannelEligibility(lead, channel, manualOverride);
    if (!eligibility.eligible) {
      const elapsedMs = Date.now() - startTime;
      return {
        draft_id: draftId,
        channel,
        lead_name: lead.firstName,
        subject: null,
        body: "",
        verdict: "INELIGIBLE",
        evaluation: {
          channel,
          lead_name: lead.firstName,
          checks: [],
          programmatic_pass: false,
          send: false,
          flags: [eligibility.reason],
        },
        flags: [eligibility.reason],
        rate_applied: null,
        telemetry: {
          model: null,
          latency_ms: 0,
          prompt_tokens: null,
          completion_tokens: null,
          total_execution_time_ms: elapsedMs,
        },
        manual_override: manualOverride,
      };
    }

    // Stage 2: Rate Card Lookup
    const [rateMatch, rateFlag] = this.rateCardService.lookupRate(
      lead.sourceLanguage,
      lead.targetLanguage,
      lead.services.length ? lead.services[0] : "Translation"
    );

    // Stage 3: Prompt Building & LLM Generation, grounded strictly in
    // lead.groundingFacts() -- see promptBuilder.ts's VOICE_RULES.
    if (!this.client) {
      throw new Error("CLAUDE_API_KEY is not configured.");
    }

    const draft: Draft =
      channel === "email"
        ? await generateEmail(this.client, this.config, lead, leadId, rateMatch, rateFlag)
        : await generateLinkedin(this.client, this.config, lead, leadId, rateMatch, rateFlag);

    // Stage 4: Programmatic Rule Evaluation (evaluator.ts)
    const ev = evaluate(draft);

    // Stage 5: Approval Queue Formatting & Verdict Assignment
    const verdict: "SEND" | "HOLD" = ev.send ? "SEND" : "HOLD";
    const elapsedMs = Date.now() - startTime;

    const telemetry = {
      model: draft.model,
      latency_ms: draft.latency_ms,
      prompt_tokens: draft.prompt_tokens,
      completion_tokens: draft.completion_tokens,
      total_execution_time_ms: elapsedMs,
    };

    return {
      draft_id: draftId,
      channel,
      lead_name: lead.firstName,
      subject: draft.subject,
      body: draft.body,
      verdict,
      evaluation: ev,
      flags: ev.flags,
      rate_applied: rateMatch,
      telemetry,
      manual_override: manualOverride,
    };
  }

  /** Stage 6: Record recruiter edits and compute similarity / edit-rate telemetry. */
  recordEdit(draftId: string, originalBody: string, editedBody: string): EditLogResult {
    return logRecruiterEdit(draftId, originalBody, editedBody);
  }
}
