/** Claude (Anthropic) chat client — direct port of
 * drafting_service/claude_client.py, moved onto the official @anthropic-ai/sdk
 * per this project's claude-api skill (the Python original used raw REST via
 * `requests`, so this is the one deliberate deviation from 1:1 porting).
 *
 * Retries now go through the shared retryWithBackoff utility (1s/2s/4s/8s,
 * 4 retries after the initial attempt) instead of this class's own inline
 * loop -- note this is a deliberate correction, not just a refactor: the
 * old inline formula (`retryBackoffBase ** (attempt + 1)`, capped at
 * `maxRetries` total attempts including the first) produced 4s/8s/16s
 * delays over only 4 total attempts, not the 1s/2s/4s/8s-over-5-attempts
 * contract every other retrying call in this server now follows. Layering
 * the SDK's own built-in retry underneath would still compound with this
 * loop, so the SDK client keeps maxRetries: 0 -- retryWithBackoff is the
 * only retry authority.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DraftingConfig } from "./config";
import { retryWithBackoff, isRetryableByDefault } from "../lib/retryWithBackoff";

export class ClaudeError extends Error {}

export interface Completion {
  text: string;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number;
}

const STRICT_JSON_SUFFIX =
  "\n\nRespond with ONLY the JSON object. No markdown code fences, no preamble, " +
  "no commentary, no explanation before or after it. The response must start " +
  "with '{' and end with '}'.";

// Opus 5 / Sonnet 5 / Fable 5 reject the `temperature` sampling parameter
// with an HTTP 400 -- only Opus 4.6/Sonnet 4.6 and older models (which
// includes the currently-configured Haiku 4.5) accept it. This guard is new
// in the port: claude_client.py sent temperature unconditionally, a latent
// bug in the Python service that would 400 the instant CLAUDE_MODEL was set
// to "sonnet"/"opus" (config.ts's aliases already resolve those to
// claude-sonnet-5/claude-opus-5). Confirmed via the claude-api skill, not
// assumed.
const NO_TEMPERATURE_MODEL_PREFIXES = ["claude-opus-5", "claude-sonnet-5", "claude-fable-5"];

function acceptsTemperature(model: string): boolean {
  return !NO_TEMPERATURE_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));
}

/** Best-effort salvage of a JSON object out of stray markdown fences/preamble.
 * Anthropic has no json_mode flag; the strict-JSON guarantee is replicated by
 * instructing the model in the prompt (see STRICT_JSON_SUFFIX) and validating
 * the shape here before returning it to the caller. */
function extractJsonText(text: string): string {
  const stripped = text.trim();
  try {
    JSON.parse(stripped);
    return stripped;
  } catch {
    // fall through to salvage
  }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && start < end) {
    const candidate = stripped.slice(start, end + 1);
    JSON.parse(candidate); // throws if still not valid -- caller's retry loop handles it
    return candidate;
  }
  throw new SyntaxError("No JSON object found in model output");
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  jsonMode?: boolean;
  maxTokens?: number;
}

export class ClaudeClient {
  private client: Anthropic;
  private cfg: DraftingConfig;

  constructor(cfg: DraftingConfig) {
    this.cfg = cfg;
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      maxRetries: 0, // this class's own loop below owns all retry/backoff decisions
      timeout: cfg.requestTimeoutMs,
    });
  }

  /** Run one chat completion. Set jsonMode to force a JSON object. */
  async chat(system: string, user: string, opts: ChatOptions = {}): Promise<Completion> {
    const model = opts.model || this.cfg.genModel;
    const temperature = opts.temperature ?? 0.5;
    const jsonMode = opts.jsonMode ?? false;
    const maxTokens = opts.maxTokens ?? 1024;

    const systemPrompt = jsonMode ? system + STRICT_JSON_SUFFIX : system;
    const body: Anthropic.MessageCreateParams = {
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: user }],
      max_tokens: maxTokens,
    };
    if (acceptsTemperature(model)) {
      (body as any).temperature = temperature;
    }

    try {
      return await retryWithBackoff(
        async () => {
          const started = Date.now();
          const response = await this.client.messages.create(body);
          const latencyMs = Date.now() - started;

          let text = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("");
          if (jsonMode) {
            text = extractJsonText(text);
          }

          return {
            text,
            model: response.model,
            prompt_tokens: response.usage?.input_tokens ?? null,
            completion_tokens: response.usage?.output_tokens ?? null,
            latency_ms: latencyMs,
          };
        },
        {
          isRetryable: isRetryableByDefault,
          onRetry: (err, attempt, delayMs) => {
            console.warn(
              `[claudeClient] Claude call failed (attempt ${attempt + 1}/5): ${(err as any)?.message || err} — retrying in ${(delayMs / 1000).toFixed(1)}s`
            );
          },
        }
      );
    } catch (err: any) {
      throw new ClaudeError(`Claude call failed after retries: ${err?.cause?.message ?? err?.message ?? err}`);
    }
  }
}
