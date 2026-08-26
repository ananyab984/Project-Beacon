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
  unipileApiKey: process.env.UNIPILE_API_KEY || "",
  unipileWebhookSecret: requireEnv("UNIPILE_WEBHOOK_SECRET"),
  unipileWebhookPathToken: requireEnv("UNIPILE_WEBHOOK_PATH_TOKEN"),
  // Same two-factor defense as Unipile's webhook (opaque path token + secret
  // header) -- Clay's outbound webhook is just as public-facing and needs
  // the same "don't trust the URL alone" posture.
  clayWebhookSecret: requireEnv("CLAY_WEBHOOK_SECRET"),
  clayWebhookPathToken: requireEnv("CLAY_WEBHOOK_PATH_TOKEN"),
  appBaseUrl: resolveEnv("APP_BASE_URL", "http://localhost:5001", isProduction),
  // 127.0.0.1, not "localhost": both Python services bind IPv4-only, but
  // "localhost" can resolve to the IPv6 loopback first depending on the
  // process's DNS resolution order -- if anything else happens to be
  // listening on the same port on ::1/[::] (e.g. the client dev server
  // during local development), that ambiguity silently routes the request
  // to the wrong service instead of a clean connection error.
  draftingServiceUrl: resolveEnv("DRAFTING_SERVICE_URL", "http://127.0.0.1:8001", isProduction),
  // Must match enrichment_pipeline/main.py's own --port default (8000, see its
  // argparse default and .env) -- a mismatch here means every enrichment call
  // fails with connection-refused and the lead just cycles PENDING forever.
  enrichmentServiceUrl: resolveEnv("ENRICHMENT_SERVICE_URL", "http://127.0.0.1:8000", isProduction),
  keepaliveEnabled: (process.env.KEEPALIVE_ENABLED || (isProduction ? "true" : "false")).trim().toLowerCase() !== "false",
  keepaliveUrl: resolveEnv("KEEPALIVE_URL", resolveEnv("APP_BASE_URL", "http://localhost:5001", isProduction), isProduction),
  keepaliveIntervalMs: parseInt(process.env.KEEPALIVE_INTERVAL_MS || "600000", 10),

  // Credentials, sessions, and email verification all live in Neon Auth now
  // (see middleware/auth.ts) -- this server only verifies the JWTs it issues.
  // Same value as the client's VITE_NEON_AUTH_URL; kept as a separate env var
  // because Vite only exposes VITE_-prefixed vars to the browser bundle, and
  // this one needs to be readable from plain Node.
  neonAuthUrl: requireEnv("NEON_AUTH_URL"),
};
