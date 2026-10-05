// Pure redirect rules for auth flows. Kept free of React / Neon imports so
// they can be unit-tested directly (src/lib/authRedirect.test.ts).

/**
 * Where to send a user after sign-in: the `?redirect=` they were bounced
 * from, but only if it is a same-origin path inside THEIR role's area.
 * Anything else falls back to their home. Following a redirect into another
 * role's area dropped people straight back on /unauthorized right after
 * signing in, and an unchecked value is an open redirect ("//evil.com").
 */
export function safeRedirect(redirect: string | undefined, role: string): string {
  const home = roleHome(role);
  if (
    !redirect ||
    !redirect.startsWith("/") ||
    redirect.startsWith("//") ||
    redirect.startsWith("/\\")
  )
    return home;
  const path = redirect.split(/[?#]/)[0];
  return path === home || path.startsWith(`${home}/`) ? redirect : home;
}

export function roleHome(role: string): string {
  const r = String(role || "").toLowerCase();
  return r === "owner" ? "/owner" : r === "recruiter" ? "/recruiter" : "/contractor";
}

// The server rejecting a token we DID send means the session died mid-use.
// Before, every screen just showed "Session has expired" with nothing to
// click; now the user is sent to sign in and brought back afterwards.
const DEAD_SESSION_CODES = new Set(["UNAUTHORIZED_TOKEN_EXPIRED", "UNAUTHORIZED_INVALID_TOKEN"]);
// Pages that work signed-out. Redirecting from these would loop.
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/onboarding",
];

export function shouldReauthenticate(
  status: number,
  code: string | undefined,
  pathname = typeof window === "undefined" ? "/" : window.location.pathname,
): boolean {
  if (status !== 401 || !code || !DEAD_SESSION_CODES.has(code)) return false;
  return !PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
