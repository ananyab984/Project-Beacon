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
  // Same two-factor defense as Unipile's webhook (opaque path token + secret
  // header) -- Clay's outbound webhook is just as public-facing and needs
  // the same "don't trust the URL alone" posture.
  clayWebhookSecret: requireEnv("CLAY_WEBHOOK_SECRET"),
  clayWebhookPathToken: requireEnv("CLAY_WEBHOOK_PATH_TOKEN"),
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

  // Public onboarding form G3's own tech team owns/operates (app.global3.io)
  // -- confirmed contract: query params first_name, last_name, email,
  // address_country, source_language, target_language, service,
  // years_of_experience, vendor_experience, linkedin, callback_url.
  // Defaults to a guaranteed-unreachable ".invalid" domain (reserved by
  // RFC 2606 to never resolve) everywhere except production, so no
  // automated test, CI run, or default dev session can ever reach the real
  // domain -- only an explicit G3_APPLY_BASE_URL set in a real production
  // environment points at it. Never hardcode the real URL as a fallback here.
  g3ApplyBaseUrl: resolveEnv("G3_APPLY_BASE_URL", "https://mock-g3-apply.invalid/apply", isProduction),

  // Two-factor defense for the onboarding webhook receiver (G3's apply form
  // calling us back), same posture as UNIPILE_WEBHOOK_SECRET/
  // UNIPILE_WEBHOOK_PATH_TOKEN below -- except their form calls
  // callback_url exactly as we hand it to them, with no custom header
  // support on their side, so both factors have to live in the URL itself:
  // an opaque path token (like Unipile's) plus a per-lead HMAC signature
  // over lead_id, so a leaked/observed callback URL for one lead can never
  // be replayed against a different lead_id.
  onboardingWebhookPathToken: requireEnv("ONBOARDING_WEBHOOK_PATH_TOKEN"),
  onboardingWebhookSecret: requireEnv("ONBOARDING_WEBHOOK_SECRET"),

  // Kill switch for a real outbound call to app.global3.io (an apply link
  // that actually points at their live domain, or a supervised live
  // webhook test). Same posture as unipileLiveSendsEnabled below: blocked
  // everywhere except production by default, only opted into for a
  // deliberate, supervised manual-verification window
  // (G3_APPLY_ALLOW_LIVE=true) -- never a standing default, never something
  // a test or dev script reaches for automatically.
  g3ApplyLiveEnabled: isProduction || (process.env.G3_APPLY_ALLOW_LIVE || "").trim().toLowerCase() === "true",

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
