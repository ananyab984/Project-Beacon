import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// These two guard the Unipile webhook receiver's only real defenses (Unipile's
// "signed webhook" claim isn't corroborated by its own API docs -- see
// Documents/Unipile_Authentication_and_Subscription_Management_Implementation_Plan.md).
// A hardcoded fallback would defeat the point of both, so fail loudly instead.
function requireEnv(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} must be set in the environment -- refusing to fall back to a default value for this one.`);
  }
  return value;
}

function resolveEnv(name: string, fallback: string, requireInProduction = false): string {
  const value = (process.env[name] || "").trim();
  if (value) return value;
  if (requireInProduction) {
    throw new Error(`${name} must be set in production -- refusing to fall back to ${fallback}.`);
  }
  return fallback;
}

const isProduction = (process.env.NODE_ENV || "").trim().toLowerCase() === "production";
// Computed once, up front, so keepaliveUrl can reuse it below without
// re-resolving (and re-validating) the same variable twice.
const appBaseUrl = resolveEnv("APP_BASE_URL", "http://localhost:5001", isProduction);

export const config = {
  port: parseInt(process.env.PORT || "5001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  clientUrl: resolveEnv("CLIENT_URL", "http://localhost:5173", isProduction),
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "super_secret_jwt_access_key_global3_2026",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || "super_secret_jwt_refresh_key_global3_2026",
  refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
  unipileDsn: process.env.UNIPILE_DSN || "api25.unipile.com:15598",
  // Was `process.env.UNIPILE_API_KEY || ""` -- silently empty if unset,
  // unlike every other Unipile secret in this file. That let a missing key
  // reach production undetected: every Unipile call sent an empty API key,
  // Unipile correctly rejected it with its own 401, and that confusing raw
  // upstream error surfaced to recruiters as an unexplained failure on the
  // Send button, with nothing pointing at the actual missing variable. Now
  // fails loudly at boot instead, matching unipileWebhookSecret/
  // unipileWebhookPathToken below.
  unipileApiKey: requireEnv("UNIPILE_API_KEY"),
  unipileWebhookSecret: requireEnv("UNIPILE_WEBHOOK_SECRET"),
  unipileWebhookPathToken: requireEnv("UNIPILE_WEBHOOK_PATH_TOKEN"),
  appBaseUrl,
  // Must match enrichment_pipeline/main.py's own --port default (8000, see its
  // argparse default and .env) -- a mismatch here means every enrichment call
  // fails with connection-refused and the lead just cycles PENDING forever.
  enrichmentServiceUrl: resolveEnv("ENRICHMENT_SERVICE_URL", "http://127.0.0.1:8000", isProduction),

  // Drafting is in-process (server/src/drafting/) -- no service URL to
  // misconfigure. Not requireEnv: the orchestrator throws at call time if
  // unset (matching the ported orchestrator.py's own RuntimeError), rather
  // than blocking the whole server from booting over a drafting-only
  // misconfiguration.
  // Autumn.ai -- recruiter-triggered re-enrichment only (never the waterfall).
  // Not requireEnv: the re-enrichment job throws at call time if it's unset,
  // so a missing key fails that one action loudly instead of blocking the
  // whole server from booting over a feature nothing else depends on.
  autumnApiKey: process.env.AUTUMN_API_KEY || "",
  autumnBaseUrl: resolveEnv("AUTUMN_BASE_URL", "https://api.autumn.ai", false),
  // Autumn's own ceiling, deliberately NOT the waterfall's. The Python
  // pipeline's cumulative cap is LEAD_LEVEL_TIMEOUT_SECONDS = 3800s
  // (orchestrator.py), sized for retrying slow scrapes across three heavy
  // stages -- unrelated to one agentic research task. (The "60s cumulative
  // cap" in schema.prisma's OnHoldReason comment is stale, predating that.)
  // 300s is ~1.7x the 175.8s the PoC's single Autumn task took to enrich all
  // 12 edge-case leads at once (POC/autumn_poc/output_edge_cases.json), so a
  // one-lead run has real headroom without hanging a recruiter for an hour.
  autumnReenrichTimeoutSeconds: parseInt(process.env.AUTUMN_REENRICH_TIMEOUT_SECONDS || "300", 10),
  // Cost guardrails. Autumn is credit-metered and its per-task price isn't
  // documented up front, so a recruiter re-clicking the same lead must not be
  // able to spend without bound. Conservative starting values, per lead.
  autumnReenrichCooldownMinutes: parseInt(process.env.AUTUMN_REENRICH_COOLDOWN_MINUTES || "10", 10),
  autumnReenrichDailyCap: parseInt(process.env.AUTUMN_REENRICH_DAILY_CAP || "3", 10),

  claudeApiKey: process.env.CLAUDE_API_KEY || "",
  claudeModel: process.env.CLAUDE_MODEL || "",
  genTemperature: parseFloat(process.env.GEN_TEMPERATURE || "0.5"),
  requestTimeoutSeconds: parseInt(process.env.REQUEST_TIMEOUT || "60", 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || "4", 10),
  retryBackoffBase: parseFloat(process.env.RETRY_BACKOFF_BASE || "2.0"),
  keepaliveEnabled: (process.env.KEEPALIVE_ENABLED || (isProduction ? "true" : "false")).trim().toLowerCase() !== "false",
  // Keeping this service alive means pinging THIS service -- appBaseUrl is
  // already required-and-validated in production two lines up, so there's
  // no real config it could be missing that requiring a second, separate
  // KEEPALIVE_URL would catch. That redundant requirement is what broke a
  // production deploy on 2026-08-29 for no actual safety benefit -- allow
  // overriding it explicitly (e.g. a distinct external uptime-ping URL) but
  // never require it on top of appBaseUrl.
  keepaliveUrl: resolveEnv("KEEPALIVE_URL", appBaseUrl, false),
  keepaliveIntervalMs: parseInt(process.env.KEEPALIVE_INTERVAL_MS || "600000", 10),

  // Credentials, sessions, and email verification all live in Neon Auth now
  // (see middleware/auth.ts) -- this server only verifies the JWTs it issues.
  // Same value as the client's VITE_NEON_AUTH_URL; kept as a separate env var
  // because Vite only exposes VITE_-prefixed vars to the browser bundle, and
  // this one needs to be readable from plain Node.
  neonAuthUrl: requireEnv("NEON_AUTH_URL"),

  // Kill switch for real outbound Unipile sends (an actual email/LinkedIn
  // message dispatched to a real third party's real inbox). Defaults to
  // BLOCKED everywhere except production: an incident where a live test
  // send reached a real person's real Gmail during local debugging showed
  // nothing previously stopped a script, curl call, or agent from
  // triggering a genuine send through a real connected account. Must be
  // explicitly opted into (UNIPILE_ALLOW_LIVE_SENDS=true) for a deliberate
  // local/staging test window -- never left on as a standing default.
  unipileLiveSendsEnabled: isProduction || (process.env.UNIPILE_ALLOW_LIVE_SENDS || "").trim().toLowerCase() === "true",
};
