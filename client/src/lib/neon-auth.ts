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

export type NeonTokenResult = { token: string | null; errorDetail?: string };

/**
 * The signed JWT our own server verifies (server/src/middleware/auth.ts) --
 * distinct from Better Auth's opaque session cookie, which isn't a JWT and
 * can't be checked against Neon's JWKS. Every authenticated call this app
 * makes to its own backend (api.ts, auth.tsx) goes through this single
 * function so there's exactly one place that knows how to get one.
 *
 * Returns the failure detail alongside the token (rather than just logging
 * it) so callers on a critical path -- like finishing account setup -- can
 * put the real reason in front of the person instead of a generic dead end.
 */
export async function getNeonTokenResult(): Promise<NeonTokenResult> {
  const { data, error } = await authClient.token();
  if (error) {
    const detail = `${error.status ?? ""} ${error.message ?? error.statusText ?? JSON.stringify(error)}`.trim();
    console.error("[auth] authClient.token() failed:", error);
    return { token: null, errorDetail: detail };
  }
  // The JWT plugin returns this shaped like a getSession() response, with the
  // signed JWT living at session.token -- not a bare { token } at the top
  // level like the REST endpoint map suggested. Tolerate both shapes (and a
  // bare string) since this couldn't be verified against a real session
  // before shipping.
  const token =
    typeof data === "string"
      ? data
      : (data as { token?: string; session?: { token?: string } } | null)?.session?.token
        ?? (data as { token?: string } | null)?.token;
  if (!token) {
    console.error("[auth] authClient.token() returned no token:", data);
    return { token: null, errorDetail: `empty response: ${JSON.stringify(data)}` };
  }
  return { token };
}

/** Convenience wrapper for the common case where only the token matters. */
export async function getNeonToken(): Promise<string | null> {
  return (await getNeonTokenResult()).token;
}
