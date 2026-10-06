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

// The public linguist onboarding/apply form G3 operates. Outreach messages
// never embed this directly -- they embed a per-lead short link
// ({appBaseUrl}/g/{token}, see lib/onboarding/shortLink.ts), which redirects
// here with that lead's enriched data pre-filled as query params (first_name,
// last_name, email, address_country, source_language, target_language,
// service, years_of_experience, vendor_experience, linkedin -- the confirmed
// contract with G3's tech team).
//
// Defaults to the DEV form in EVERY environment, production included,
// because that is the intended target today. This deliberately does NOT
// require the variable in production: that is what it did first, and it took
// the API down on deploy with "G3_APPLY_BASE_URL must be set in production".
// render.yaml declaring the value doesn't help, because the live Render
// service isn't created from that blueprint -- it's named
// Project-Beacon-server while the blueprint declares g3-server, so nothing
// in render.yaml reaches it. A hard boot failure only clearable from a
// dashboard is worse than a loud line in the logs.
//
// Production still announces it on every boot, so once a real production
// apply form exists, a box still pointing at the dev form shows up in the
// logs rather than passing silently.
// Base URL for the per-lead short links embedded in outreach
// ({shortLinkBaseUrl}/g/{token}, see lib/onboarding/shortLink.ts). This is a
// link a CANDIDATE sees and clicks in a cold email or LinkedIn note, so it
// has to read as Global3's own domain -- a bare Render hostname like
// project-beacon-server-6zmg.onrender.com looks like a redirect to someone
// else's server and gets treated as suspicious.
//
// Separate from APP_BASE_URL on purpose, even though it defaults to it:
// APP_BASE_URL also builds the Unipile webhook notify_url
// (unipile.service.ts), so repointing that to a pretty domain would move the
// webhook endpoint for every new account connection as a side effect. These
// two just answer different questions -- "where do Unipile's callbacks go"
// vs "what domain do we show a candidate" -- and only the second needs to be
// presentable.
//
// Set SHORT_LINK_BASE_URL to a Global3 domain pointed at this service
// (Render custom domain + a CNAME). Until it's set, this falls back to
// APP_BASE_URL so nothing breaks -- the links just aren't branded yet.
// Trailing slashes are stripped: this value gets pasted into a dashboard by
// hand, and "https://apply.global3.co/" would otherwise build
// "https://apply.global3.co//g/<token>" into every outreach message. Same
// normalization keepaliveUrl and absoluteAppUrl already do.
const shortLinkBaseUrl = resolveEnv("SHORT_LINK_BASE_URL", appBaseUrl, false).replace(/\/+$/, "");

const G3_APPLY_DEV_FORM = "https://app.dev.global3.co/apply";
const g3ApplyBaseUrl = resolveEnv("G3_APPLY_BASE_URL", G3_APPLY_DEV_FORM, false);
if (isProduction && g3ApplyBaseUrl === G3_APPLY_DEV_FORM) {
  console.warn(
    `[config] G3_APPLY_BASE_URL is not set -- this production instance is sending candidates to the DEV apply form (${G3_APPLY_DEV_FORM}). Set G3_APPLY_BASE_URL once a production apply form exists.`
  );
}

export const config = {
  port: parseInt(process.env.PORT || "5001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  clientUrl: resolveEnv("CLIENT_URL", "http://localhost:5173", isProduction),
  databaseUrl: process.env.DATABASE_URL || "",
  // Unipile's DSN is account-specific (each customer gets its own dedicated
  // subdomain/port) -- a key that's genuinely valid for one account will
  // still get a flat 401 invalid_credentials from a DIFFERENT account's DSN,
  // which looks identical to "the key is wrong" from the response alone.
  // The literal string below is a real DSN from whenever this file was
  // first written, not a placeholder -- silently falling back to it if
  // UNIPILE_DSN is ever unset (or a rotated key's own DSN was never updated
  // to match) means every hosted-auth mint 401s with no indication the
  // DSN, not the key, is the actual mismatch. requireInProduction so a real
  // deploy fails loudly at boot instead, matching unipileApiKey below.
  unipileDsn: resolveEnv("UNIPILE_DSN", "api25.unipile.com:15598", isProduction),
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

  g3ApplyBaseUrl,
  shortLinkBaseUrl,
  // Must match enrichment_pipeline/main.py's own --port default (8000, see its
  // argparse default and .env) -- a mismatch here means every enrichment call
  // fails with connection-refused and the lead just cycles PENDING forever.
  // Trailing slashes stripped: the call site appends "/enrich", and
  // "https://host//enrich" 404s (docs/DOCKER_DEPLOY.md's known trailing-slash bug).
  enrichmentServiceUrl: resolveEnv("ENRICHMENT_SERVICE_URL", "http://127.0.0.1:8000", isProduction).replace(/\/+$/, ""),
  // Shared secret proving a call to the enrichment service actually came
  // from this server, not an arbitrary caller who found the URL -- the
  // service has no other authentication and every call triggers real,
  // paid BrightData/Tavily/Claude usage. Must be set to the same value on
  // enrichment_pipeline's own deployment (ENRICHMENT_SERVICE_SHARED_SECRET
  // there too) or every enrichment call starts failing with 401.
  enrichmentServiceSharedSecret: requireEnv("ENRICHMENT_SERVICE_SHARED_SECRET"),

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
  // Groq (inbound reply classification) -- same "empty string, throw at call
  // time" pattern as claudeApiKey: classification-only failure must never
  // block the whole server from booting.
  groqApiKey: process.env.GROQ_API_KEY || "",
  groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
  // Single kill switch for the whole inbound reply classification feature --
  // flipping this off must be enough on its own to fully undo it: the
  // webhook stops running the classifier (processInboundMessage.ts), the
  // manual-override write path on PATCH /api/leads/:id starts rejecting,
  // and every client surface (nav item, category dashboard, badge/dropdown
  // on both the LinkedIn and Email views) hides itself -- all three read
  // this one value via GET /api/reply-categories' `featureEnabled` field,
  // not a separate flag each, so there's exactly one place this can drift.
  // Defaults on: this is live functionality, not something opt-in.
  replyClassificationEnabled: (process.env.REPLY_CLASSIFICATION_ENABLED || "true").trim().toLowerCase() !== "false",
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

  // Kill switch for the 9 in-process cron jobs (jobs/index.ts). Defaults ON --
  // every real deployment wants them, and exactly one instance must run them
  // (pollInFlight in jobs/enrichment.job.ts is in-memory, so a second instance
  // running jobs would double every digest and blow past the 8-wide enrichment
  // concurrency cap).
  // The reason this exists: booting the API with jobs on has side effects that
  // reach real third parties -- Slack posts, due-date reminders, weekly
  // digests, and a poll that spends real money on enrichment every 3 minutes.
  // A throwaway container (a Docker smoke test, a one-off shell against a copy
  // of the data) needs the HTTP server without any of that, and before this
  // flag there was no way to get one.
  backgroundJobsEnabled: (process.env.BACKGROUND_JOBS_ENABLED || "true").trim().toLowerCase() !== "false",
  // On SIGTERM, how long to let in-flight enrichments finish before handing
  // the rest back to the queue (index.ts). MUST stay below the platform's own
  // kill window or the requeue never runs: 20s fits Render's/ECS's 30s
  // default; raise it only together with that window (Render
  // maxShutdownDelaySeconds, ECS stopTimeout).
  shutdownDrainMs: parseInt(process.env.SHUTDOWN_DRAIN_MS || "20000", 10),
  // After boot, wait this long before requeueing leads an earlier process
  // left IN_PROGRESS (a crash). Render's zero-downtime deploy keeps the old
  // instance running briefly, so 5 min there; 0 on AWS (stop-before-start,
  // one container).
  requeueDelayMs: parseInt(process.env.REQUEUE_DELAY_MS || "300000", 10),

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

  // Notifications -- the Slack bot token and the notification-email account
  // id are owner-configurable in-app now (SystemConfig, via
  // system-settings.service.ts's getSystemSetting), not read from this
  // config object directly. Both channels remain optional: until either is
  // set (here or in-app), that one delivery channel silently no-ops (see
  // notification.service.ts) rather than blocking the whole server, or the
  // in-app bell, from working.
  // How many days out a Requirement's deadline must be before it triggers a
  // due-date reminder. Placeholder default pending G3 sign-off (see plan's
  // "Deliverables needed from Global3" #4) -- override via env in the
  // meantime rather than hardcoding.
  dueDateReminderWindowDays: parseInt(process.env.DUE_DATE_REMINDER_WINDOW_DAYS || "3", 10),
};
