/** Drafting-specific config slice, derived from server/src/config.ts's raw
 * env reads. Direct port of drafting_service/config.py's model-alias
 * resolution and unit handling. */

import { config as serverConfig } from "../config";

export interface DraftingConfig {
  apiKey: string;
  genModel: string;
  genTemperature: number;
  requestTimeoutMs: number;
  maxRetries: number;
  retryBackoffBase: number;
}

// Friendly-name aliases accepted in CLAUDE_MODEL, mapped to real Anthropic
// model IDs. Python's default resolved "haiku" to the stale, dated
// "claude-haiku-4-5-20251001" -- fixed here to the current bare ID per
// explicit sign-off during the port (see plan: "Fix bugs in port").
const CLAUDE_MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
};

/** Map a friendly alias (e.g. 'sonnet') to a real Anthropic model ID; pass
 * through anything else unchanged. */
function resolveClaudeModel(raw: string): string {
  const key = (raw || "").trim().toLowerCase();
  if (!key) return CLAUDE_MODEL_ALIASES.haiku;
  return CLAUDE_MODEL_ALIASES[key] || raw.trim();
}

export function loadDraftingConfig(): DraftingConfig {
  return {
    apiKey: serverConfig.claudeApiKey,
    genModel: resolveClaudeModel(serverConfig.claudeModel),
    genTemperature: serverConfig.genTemperature,
    // Python's REQUEST_TIMEOUT env var is in seconds; the Anthropic TS SDK's
    // `timeout` client option is in milliseconds -- converted here, not
    // copied raw (a literal copy would silently become 60ms instead of 60s).
    requestTimeoutMs: serverConfig.requestTimeoutSeconds * 1000,
    maxRetries: serverConfig.maxRetries,
    retryBackoffBase: serverConfig.retryBackoffBase,
  };
}
