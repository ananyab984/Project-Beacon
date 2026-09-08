/** Groq chat client for inbound reply classification -- mirrors
 * ClaudeClient's public interface exactly (same Completion shape, same
 * chat(system, user, opts) signature, same retryWithBackoff usage) so
 * callers written against one read identically against the other.
 *
 * Unlike ClaudeClient, jsonMode here uses Groq's native OpenAI-compatible
 * `response_format: { type: "json_object" }` instead of a manual
 * JSON-salvage step -- Groq's models support real JSON mode; Anthropic's
 * don't, which is why claudeClient.ts needs its own extractJsonText salvage.
 */

import Groq from "groq-sdk";
import type { DraftingConfig } from "./config";
import type { Completion, ChatOptions } from "./claudeClient";
import { retryWithBackoff, isRetryableByDefault } from "../lib/retryWithBackoff";

export class GroqError extends Error {}

export class GroqClient {
  private client: Groq;
  private cfg: DraftingConfig;

  constructor(cfg: DraftingConfig) {
    this.cfg = cfg;
    this.client = new Groq({ apiKey: cfg.groqApiKey, maxRetries: 0, timeout: cfg.requestTimeoutMs });
  }

  /** Run one chat completion. Set jsonMode to force a JSON object response. */
  async chat(system: string, user: string, opts: ChatOptions = {}): Promise<Completion> {
    const model = opts.model || this.cfg.groqModel;
    // Lower than ClaudeClient's 0.5 default -- classification wants
    // determinism, not creativity.
    const temperature = opts.temperature ?? 0.3;
    const jsonMode = opts.jsonMode ?? false;
    // Classification responses are tiny: {categoryId, confidence}.
    const maxTokens = opts.maxTokens ?? 256;

    try {
      return await retryWithBackoff(
        async (signal) => {
          const started = Date.now();
          const response = await this.client.chat.completions.create(
            {
              model,
              temperature,
              max_tokens: maxTokens,
              response_format: jsonMode ? { type: "json_object" } : undefined,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            },
            { signal }
          );
          const latencyMs = Date.now() - started;
          const text = response.choices[0]?.message?.content ?? "";

          return {
            text,
            model: response.model,
            prompt_tokens: response.usage?.prompt_tokens ?? null,
            completion_tokens: response.usage?.completion_tokens ?? null,
            latency_ms: latencyMs,
          };
        },
        {
          isRetryable: isRetryableByDefault,
          deadlineMs: 15000,
          onRetry: (err, attempt, delayMs) => {
            console.warn(
              `[groqClient] Groq call failed (attempt ${attempt + 1}/5): ${(err as any)?.message || err} — retrying in ${(delayMs / 1000).toFixed(1)}s`
            );
          },
        }
      );
    } catch (err: any) {
      throw new GroqError(`Groq call failed after retries: ${err?.cause?.message ?? err?.message ?? err}`);
    }
  }
}
