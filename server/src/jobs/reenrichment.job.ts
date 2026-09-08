import axios from "axios";
import { prisma } from "../prisma";
import { config } from "../config";
import { retryWithBackoff } from "../lib/retryWithBackoff";
import { computeOnHoldTransition } from "../lib/onHoldTransition";
import {
  AUTUMN_OUTPUT_SCHEMA,
  mapAutumnOutputToLeadFields,
} from "../lib/reenrichmentFieldMapping";

/**
 * Recruiter-triggered re-enrichment via Autumn.ai.
 *
 * Deliberately NOT part of the enrichment waterfall (Bright Data/Tavily ->
 * Parallel -> LLM fallback, enrichment.job.ts). Autumn is agent-based: you
 * submit a task, it runs for minutes, you poll it, then you fetch structured
 * output. That lifecycle has nothing in common with the waterfall's single
 * synchronous /enrich call, so it gets its own file, its own timeout, and its
 * own status record (ReenrichmentRun) rather than overloading the waterfall's
 * enrichmentStatus.
 *
 * Every API detail here was confirmed against real credentials in
 * POC/autumn_poc/autumn_test.py -- see that script's docstring for what the
 * docs do and don't cover, particularly `kind: "research"` (the kind that
 * takes a custom schema as-given; "person" merges yours into a 55-90 field
 * built-in schema instead) and the task lifecycle notes below.
 */

const AUTUMN_VERSION = "ranger"; // "ranger" = most capable (default), "scout" = faster/cheaper
const HTTP_TIMEOUT_MS = 60_000;
const START_TASK_TIMEOUT_MS = 90_000;
const MIN_POLL_DELAY_MS = 2_000;
const BASE_POLL_DELAY_MS = 5_000;
const MAX_POLL_DELAY_MS = 30_000;

let creditsShapeLogged = false;

export interface CreditSnapshot {
  used: number | null;
  remaining: number | null;
}

/**
 * GET /credits' real response shape, confirmed live 2026-09-08:
 *   {plan, unlimited, credits_remaining, credits_used, credits_total,
 *    monthly_credits, billing_reset_at}
 * None of the key names the PoC guessed at ("balance", "credits", ...)
 * exist, which is why its runs all logged a null cost.
 */
export function parseCreditSnapshot(body: Record<string, unknown> | null | undefined): CreditSnapshot {
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return { used: num(body?.credits_used), remaining: num(body?.credits_remaining) };
}

/**
 * What one run actually cost. Prefers the monotonic `credits_used` counter
 * over the remaining balance: a top-up landing mid-run would make a
 * remaining-balance diff read as negative (or as free), whereas the used
 * counter only ever moves one way.
 */
export function creditsSpent(before: CreditSnapshot | null, after: CreditSnapshot | null): number | null {
  if (!before || !after) return null;
  if (before.used !== null && after.used !== null) return after.used - before.used;
  if (before.remaining !== null && after.remaining !== null) return before.remaining - after.remaining;
  return null;
}

function autumnHeaders() {
  return { "X-API-Key": config.autumnApiKey, "Content-Type": "application/json" };
}

async function autumnGet<T = any>(path: string): Promise<T> {
  const resp = await retryWithBackoff(() =>
    axios.get(`${config.autumnBaseUrl}${path}`, { headers: autumnHeaders(), timeout: HTTP_TIMEOUT_MS })
  );
  return resp.data as T;
}

async function getCreditSnapshot(): Promise<CreditSnapshot | null> {
  try {
    const data = await autumnGet<Record<string, unknown>>("/credits");
    if (!creditsShapeLogged) {
      console.log(`[reenrichment] raw GET /credits body: ${JSON.stringify(data)}`);
      creditsShapeLogged = true;
    }
    return parseCreditSnapshot(data);
  } catch (err: any) {
    console.warn(`[reenrichment] could not read credit balance: ${err?.message || err}`);
    return null;
  }
}

function buildPrompt(lead: { displayName: string | null; fullName: string | null; profileLink: string | null; source: string }): string {
  const name = lead.displayName || lead.fullName || "this person";
  return (
    `Extract everything available about the profile at this exact URL: ${lead.profileLink}\n\n` +
    `This is "${name}" on ${lead.source}. Do not research or describe a different person, and do not ` +
    "substitute a same-named person from a different platform or company.\n\n" +
    "This is a maximal extraction, not a minimal one — do not stop once a few fields are filled. Extract: " +
    "full name, headline/tagline, current job title, current company/employer, location, and the full " +
    "about/bio text — including an unlabeled introductory paragraph with no heading, which is the single " +
    "most commonly missed field, so look hard for it.\n\n" +
    'For `experience`: one string per role, formatted as "Title at Company (dates): short description if ' +
    "available\". For `qualifications`: one string per real professional qualification (degree, license, " +
    "certification) — not platform skill badges. For `platform_badges`: one string per platform-issued " +
    'badge, verification status, or membership tier. For `languages`: one string per language, formatted as ' +
    '"Language (proficiency level)" if a level is listed, otherwise just the language name.\n\n' +
    "Copy `entity_url` straight through into your output unchanged.\n\n" +
    "Only extract what is literally present on the page or in what you found — never infer, estimate, or " +
    "fill in from general knowledge about this person, company, or platform. Use an empty list for any list " +
    "field with nothing to report — never omit the field. Leave a field empty rather than guessing."
  );
}

async function startTask(lead: any): Promise<string> {
  const body = {
    prompt: buildPrompt(lead),
    clarify: false,
    version: AUTUMN_VERSION,
    output: {
      id: `reenrich-${lead.id}`,
      kind: "research",
      path: `outputs/reenrich_${lead.id}.jsonl`,
      target_count: 1,
      schema: AUTUMN_OUTPUT_SCHEMA,
      schema_order: Object.keys(AUTUMN_OUTPUT_SCHEMA),
    },
  };
  const resp = await retryWithBackoff(() =>
    axios.post(`${config.autumnBaseUrl}/task/start`, body, {
      headers: autumnHeaders(),
      timeout: START_TASK_TIMEOUT_MS,
    })
  );
  const taskId = resp.data?.task_id;
  if (!taskId) throw new Error(`Autumn returned no task_id: ${JSON.stringify(resp.data).slice(0, 500)}`);
  return taskId;
}

export interface TaskState {
  status?: string;
  activity?: string;
  output_count?: number;
  poll_after_s?: number;
}

export interface PollDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fetchTask: (taskId: string) => Promise<TaskState>;
}

export type PollOutcome = "idle" | "timed_out" | "deleted";

/**
 * Polls one Autumn task to a terminal state, bounded by a hard wall-clock
 * deadline.
 *
 * Two lifecycle details, both confirmed live in the PoC:
 *  - a FINISHED task reports `status: "plan"` / `activity: "idle"` -- but so
 *    does a task that hasn't started yet, so idle only counts as finished
 *    once the task has been seen running (or has produced output, which
 *    covers a task that finishes between two polls).
 *  - `status: "deleted"` means the task was destroyed mid-run, in practice
 *    because credits ran out.
 *
 * Backoff honours Autumn's own `poll_after_s` hint when it sends one --
 * that hint IS its documented pacing mechanism (there is no SSE/streaming
 * endpoint in its API) -- and otherwise doubles 5s -> 30s rather than
 * hammering a fixed short interval. Deps are injected so the deadline
 * behaviour is testable without real time or a real API.
 */
export async function pollUntilIdle(
  taskId: string,
  deadlineMs: number,
  deps: PollDeps
): Promise<{ outcome: PollOutcome; last: TaskState }> {
  const startedAt = deps.now();
  let seenRunning = false;
  let delayMs = BASE_POLL_DELAY_MS;
  let last: TaskState = {};

  while (deps.now() - startedAt < deadlineMs) {
    last = await deps.fetchTask(taskId);

    if (last.status === "deleted") return { outcome: "deleted", last };
    if (last.activity && last.activity !== "idle") seenRunning = true;
    if (last.activity === "idle" && (seenRunning || (last.output_count ?? 0) > 0)) {
      return { outcome: "idle", last };
    }

    const hinted = last.poll_after_s ? last.poll_after_s * 1000 : delayMs;
    const remaining = deadlineMs - (deps.now() - startedAt);
    if (remaining <= 0) break;
    await deps.sleep(Math.min(Math.max(hinted, MIN_POLL_DELAY_MS), remaining));
    delayMs = Math.min(delayMs * 2, MAX_POLL_DELAY_MS);
  }

  return { outcome: "timed_out", last };
}

/** Autumn output cells are `{value, source_id}` with a sibling `_sources`
 *  map of source_id -> url; everything else comes through as a plain value. */
function flattenRow(row: Record<string, any>): { values: Record<string, unknown>; citations: Record<string, string> } {
  const citations = (row._sources ?? {}) as Record<string, string>;
  const values: Record<string, unknown> = {};
  for (const [key, cell] of Object.entries(row)) {
    if (key.startsWith("_")) continue;
    values[key] = cell && typeof cell === "object" && "value" in cell ? (cell as any).value : cell;
  }
  return { values, citations };
}

async function concludeRun(
  runId: string,
  leadId: string,
  status: "FAILED" | "TIMED_OUT",
  message: string,
  creditsUsed: number | null
) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (lead) {
    const { flags, onHoldReason } = computeOnHoldTransition({
      currentFlags: (lead.flags as string[]) ?? [],
      currentOnHoldReason: lead.onHoldReason,
      outcome: status === "TIMED_OUT" ? "timed_out" : "system_error",
    });
    // Only the hold state changes -- a failed or timed-out run must leave
    // every enriched field exactly as it found it.
    await prisma.lead.update({ where: { id: lead.id }, data: { flags: flags as any, onHoldReason } });
  }
  await prisma.reenrichmentRun.update({
    where: { id: runId },
    data: { status, message: message.slice(0, 1000), creditsUsed, fieldsWritten: 0, finishedAt: new Date() },
  });
}

/**
 * Runs one re-enrichment end to end. Called fire-and-forget from the route --
 * an Autumn task takes minutes, so the recruiter's HTTP request never waits
 * on it; progress is read back off the ReenrichmentRun row instead.
 */
export async function runAutumnReenrichment(runId: string): Promise<void> {
  const run = await prisma.reenrichmentRun.findUnique({ where: { id: runId }, include: { lead: true } });
  if (!run) return;
  const lead = run.lead;

  let creditsBefore: CreditSnapshot | null = null;
  let creditsUsed: number | null = null;

  try {
    // Checked before anything is attempted: a missing key is a configuration
    // fault, and retryWithBackoff would otherwise spend its full 15s of
    // backoff on it and bury the cause under "all 5 attempts failed".
    if (!config.autumnApiKey) {
      await concludeRun(runId, lead.id, "FAILED", "Autumn isn't configured on this server (AUTUMN_API_KEY is not set).", null);
      return;
    }
    if (!lead.profileLink) {
      await concludeRun(runId, lead.id, "FAILED", "This lead has no profile link for Autumn to research.", null);
      return;
    }

    creditsBefore = await getCreditSnapshot();

    const taskId = await startTask(lead);
    await prisma.reenrichmentRun.update({ where: { id: runId }, data: { taskId } });
    console.log(`[reenrichment] lead ${lead.id}: Autumn task ${taskId} started`);

    const { outcome } = await pollUntilIdle(taskId, config.autumnReenrichTimeoutSeconds * 1000, {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetchTask: (id) => autumnGet<TaskState>(`/task/${id}`),
    });

    creditsUsed = creditsSpent(creditsBefore, await getCreditSnapshot());
    console.log(`[reenrichment] lead ${lead.id}: task ${taskId} ended as "${outcome}", credits used: ${creditsUsed ?? "unknown"}`);

    if (outcome === "timed_out") {
      await concludeRun(
        runId,
        lead.id,
        "TIMED_OUT",
        `Autumn did not finish within ${config.autumnReenrichTimeoutSeconds}s. The lead has been put On Hold; its existing data is unchanged.`,
        creditsUsed
      );
      return;
    }
    if (outcome === "deleted") {
      await concludeRun(runId, lead.id, "FAILED", "Autumn deleted the task mid-run — usually means the account ran out of credits.", creditsUsed);
      return;
    }

    const output = await autumnGet<{ rows?: Record<string, any>[] }>(`/task/${taskId}/output`);
    const rows = output?.rows ?? [];
    if (!rows.length) {
      await concludeRun(runId, lead.id, "FAILED", "Autumn finished but returned no data for this profile.", creditsUsed);
      return;
    }

    const { values, citations } = flattenRow(rows[0]);

    // Re-read rather than trusting the snapshot taken before the task ran:
    // an Autumn run lasts minutes, and a recruiter can perfectly well edit a
    // field or place a manual hold while it's going. Mapping against the
    // stale copy would overwrite an edit made two minutes ago -- exactly the
    // clobbering this whole path is supposed to prevent.
    const current = await prisma.lead.findUnique({ where: { id: lead.id } });
    if (!current) return;

    const mapped = mapAutumnOutputToLeadFields(
      values,
      current.fieldSources as Record<string, string> | null,
      current as unknown as Record<string, unknown>
    );
    const { flags, onHoldReason } = computeOnHoldTransition({
      currentFlags: (current.flags as string[]) ?? [],
      currentOnHoldReason: current.onHoldReason,
      outcome: "concluded_normally",
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...mapped.updates,
        fieldSources: mapped.fieldSources as any,
        // Verbatim, including the fields with no shape-compatible column
        // (experience, languages, platform_badges, current_company) and the
        // per-cell citation URLs -- nothing Autumn found is dropped.
        autumnData: { taskId, row: values, citations } as any,
        flags: flags as any,
        onHoldReason,
      },
    });

    await prisma.reenrichmentRun.update({
      where: { id: runId },
      data: {
        status: "COMPLETED",
        creditsUsed,
        fieldsWritten: mapped.writtenFields.length,
        conflicts: mapped.conflicts.length ? (mapped.conflicts as any) : undefined,
        finishedAt: new Date(),
        message:
          [
            mapped.skippedManual.length ? `Kept your manually-entered values for: ${mapped.skippedManual.join(", ")}` : null,
            // Re-enrichment fills gaps rather than overwriting, so a lead
            // that's already complete legitimately changes nothing -- say so,
            // otherwise "0 fields updated" reads as a failure.
            mapped.conflicts.length
              ? `${mapped.conflicts.length} field(s) already had a different value — choose which to keep below.`
              : mapped.skippedPopulated.length
              ? `Already had the same value: ${mapped.skippedPopulated.join(", ")}.`
              : null,
          ]
            .filter(Boolean)
            .join(" ") || null,
      },
    });
    console.log(
      `[reenrichment] lead ${lead.id}: wrote ${mapped.writtenFields.length} field(s)` +
        (mapped.skippedManual.length ? `, preserved ${mapped.skippedManual.length} manual field(s)` : "")
    );
  } catch (err: any) {
    const status = err?.response?.status;
    const message =
      status === 401
        ? "Autumn rejected the API key (401) — check AUTUMN_API_KEY."
        : status === 402
        ? "Autumn is out of credits (402)."
        : `Re-enrichment failed: ${err?.message || err}`;
    console.error(`[reenrichment] lead ${run.leadId} failed:`, err?.message || err);
    await concludeRun(runId, run.leadId, "FAILED", message, creditsUsed).catch(() => {});
  }
}
