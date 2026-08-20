import { createAuthClient } from "@neondatabase/neon-js/auth";
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react/adapters";

/**
 * Neon Auth (Managed Better Auth) handles credentials, sessions, and email
 * verification directly -- this app's own server never sees a password or
 * an OTP code. See server/src/middleware/auth.ts for how the backend verifies
 * the session tokens this client obtains.
 */
export const authClient = createAuthClient(import.meta.env.VITE_NEON_AUTH_URL, {
  adapter: BetterAuthReactAdapter({ fetchOptions: { credentials: "include" } }),
});

/**
 * The signed JWT our own server verifies (server/src/middleware/auth.ts) --
 * distinct from Better Auth's opaque session cookie, which isn't a JWT and
 * can't be checked against Neon's JWKS. Every authenticated call this app
 * makes to its own backend (api.ts, auth.tsx) goes through this single
 * function so there's exactly one place that knows how to get one.
 */
export async function getNeonToken(): Promise<string | null> {
  const { data, error } = await authClient.token();
  if (error) {
    console.error("[auth] authClient.token() failed:", error);
    return null;
  }
  const token = typeof data === "string" ? data : (data as { token?: string } | null)?.token;
  if (!token) console.error("[auth] authClient.token() returned no token:", data);
  return token ?? null;
}
