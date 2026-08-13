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

export const config = {
  port: parseInt(process.env.PORT || "5001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "super_secret_jwt_access_key_global3_2026",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || "super_secret_jwt_refresh_key_global3_2026",
  refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
  unipileDsn: process.env.UNIPILE_DSN || "api25.unipile.com:15598",
  unipileApiKey: process.env.UNIPILE_API_KEY || "",
  unipileWebhookSecret: requireEnv("UNIPILE_WEBHOOK_SECRET"),
  unipileWebhookPathToken: requireEnv("UNIPILE_WEBHOOK_PATH_TOKEN"),
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:5001",
  // 127.0.0.1, not "localhost": both Python services bind IPv4-only, but
  // "localhost" can resolve to the IPv6 loopback first depending on the
  // process's DNS resolution order -- if anything else happens to be
  // listening on the same port on ::1/[::] (e.g. the client dev server
  // during local development), that ambiguity silently routes the request
  // to the wrong service instead of a clean connection error.
  draftingServiceUrl: process.env.DRAFTING_SERVICE_URL || "http://127.0.0.1:8001",
  enrichmentServiceUrl: process.env.ENRICHMENT_SERVICE_URL || "http://127.0.0.1:8002",
};
