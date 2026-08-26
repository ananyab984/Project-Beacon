import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient, getNeonToken, getNeonTokenResult } from "./neon-auth";

export type Role = "owner" | "recruiter" | "contractor";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
};

// Strip a trailing slash from VITE_API_BASE_URL before appending "/api/auth"
// -- a trailing slash here produces a double slash ("...com//api/auth/me")
// that Express's router 404s on. Confirmed live: this was the actual cause
// of "Couldn't reach Global3's server to check your account" in production.
const API_BASE_URL = `${(import.meta.env.VITE_API_BASE_URL || "http://localhost:5001").replace(/\/+$/, "")}/api/auth`;

/**
 * The role picked on /signup can't be attached to the Neon Auth identity
 * itself (Neon Auth carries no app-specific claims), so it's stashed here
 * between "create the Neon Auth account" and "first real sign-in", when our
 * own backend profile actually gets created. Same-device signup -> verify ->
 * sign-in is the common path this covers; see needsRoleSetup for the other one.
 */
function pendingRoleKey(email: string) {
  return `g3.pendingRole:${email.trim().toLowerCase()}`;
}

type AuthError = Error & { code?: string; status?: number; email?: string };

function toError(message: string, extra?: { code?: string; status?: number; email?: string }): AuthError {
  const err = new Error(message) as AuthError;
  if (extra?.code) err.code = extra.code;
  if (extra?.status) err.status = extra.status;
  if (extra?.email) err.email = extra.email;
  return err;
}

async function fetchAppProfile(token: string): Promise<AuthUser | "NO_PROFILE" | null> {
  const res = await fetch(`${API_BASE_URL}/me`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.user) return data.user as AuthUser;
  if (res.status === 404 && data.error === "NO_PROFILE") return "NO_PROFILE";
  console.error("[auth] GET /api/auth/me failed:", res.status, data);
  return null;
}

async function postProfile(token: string, body: { role?: Role; name?: string }): Promise<AuthUser> {
  const res = await fetch(`${API_BASE_URL}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("[auth] POST /api/auth/profile failed:", res.status, data);
    throw toError(data?.message || `Could not finish setting up your account (${res.status})`, { code: data?.error, status: res.status });
  }
  return data.user as AuthUser;
}

type AuthCtx = {
  user: AuthUser | null;
  isHydrating: boolean;
  /** True once a verified Neon Auth session exists but no linked app profile could be resolved automatically -- the UI should ask the person to pick a role. */
  needsRoleSetup: boolean;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (input: { name: string; email: string; password: string; role: Role }) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  sendVerificationOtp: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, otp: string) => Promise<void>;
  completeProfile: (role: Role) => Promise<AuthUser>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [needsRoleSetup, setNeedsRoleSetup] = useState(false);
  // The QueryClient is one instance for the whole browser tab's lifetime
  // (router.tsx), not per-user -- so switching who's signed in without a
  // full page reload otherwise leaves the previous recruiter's cached
  // conversations, email queue, etc. sitting under the same query keys for
  // whoever is now signed in to see, until each query happens to refetch.
  // Every place identity changes below must clear it.
  const queryClient = useQueryClient();

  /**
   * Given an active Neon Auth session, resolve (or auto-link) the app
   * profile. Returns a discriminated result rather than null-for-everything
   * so a genuine "never set up" case can't be confused with "the token/
   * network call itself failed" -- collapsing those together was the exact
   * bug that made real failures show up as a misleading "not set up yet"
   * screen with no way to tell what actually went wrong.
   */
  const resolveProfile = useCallback(async (): Promise<
    { status: "ok"; user: AuthUser } | { status: "no_profile" } | { status: "error"; detail: string }
  > => {
    const { token, errorDetail } = await getNeonTokenResult();
    if (!token) {
      return { status: "error", detail: `Couldn't get a session token from Neon Auth: ${errorDetail || "unknown reason"}` };
    }

    const result = await fetchAppProfile(token);
    if (result === null) {
      return { status: "error", detail: "Couldn't reach Global3's server to check your account. Check the browser console for details." };
    }
    if (result !== "NO_PROFILE") {
      return { status: "ok", user: result };
    }

    // No profile yet -- try to auto-link using the role picked at signup,
    // in case the immediate post-verification attempt (see verifyEmailOtp)
    // didn't get a chance to run or failed transiently.
    const { data: sessionData } = await authClient.getSession();
    const email = sessionData?.user?.email;
    const pendingRole = email ? (sessionStorage.getItem(pendingRoleKey(email)) as Role | null) : null;

    if (email && pendingRole) {
      try {
        const linked = await postProfile(token, { role: pendingRole });
        sessionStorage.removeItem(pendingRoleKey(email));
        return { status: "ok", user: linked };
      } catch (err) {
        return { status: "error", detail: err instanceof Error ? err.message : "Could not finish setting up your profile" };
      }
    }

    return { status: "no_profile" };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await authClient.getSession();
        if (data?.user) {
          const resolution = await resolveProfile();
          if (resolution.status === "ok") setUser(resolution.user);
          setNeedsRoleSetup(resolution.status === "no_profile");
        }
      } finally {
        setIsHydrating(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      // Better Auth's email/password plugin returns this code when "Verify
      // at Sign-up" is enabled and the account hasn't verified yet.
      throw toError(error.message || "Invalid email or password", { code: error.code, status: error.status, email });
    }

    const resolution = await resolveProfile();
    if (resolution.status === "ok") {
      // Discard anything cached under the previous identity (this tab's own
      // sign-out already clears it, but a session expiring and a different
      // person signing back in on the same tab wouldn't otherwise go through
      // that path) before this recruiter's own data starts loading in.
      queryClient.clear();
      setNeedsRoleSetup(false);
      setUser(resolution.user);
      return resolution.user;
    }
    if (resolution.status === "no_profile") {
      setNeedsRoleSetup(true);
      throw toError("This account isn't set up in Global3 yet. Choose a role to finish setting up.", { code: "NO_PROFILE", email });
    }
    setNeedsRoleSetup(false);
    throw toError(resolution.detail, { code: "PROFILE_CHECK_FAILED", email });
  }, [resolveProfile, queryClient]);

  const signUp = useCallback(async ({ name, email, password, role }: { name: string; email: string; password: string; role: Role }) => {
    const { error } = await authClient.signUp.email({ email, password, name });
    if (error) throw toError(error.message || "Sign-up failed", { code: error.code, status: error.status });
    sessionStorage.setItem(pendingRoleKey(email), role);
  }, []);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    // Without this, the next person to use this browser tab (a shared
    // machine, or just switching accounts without a full reload) would see
    // this recruiter's cached conversations/email queue/leads under the same
    // query keys until each one happened to refetch.
    queryClient.clear();
    setUser(null);
    setNeedsRoleSetup(false);
  }, [queryClient]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
    if (error) throw toError(error.message || "Could not send reset link");
  }, []);

  const resetPassword = useCallback(async (token: string, newPassword: string) => {
    const { error } = await authClient.resetPassword({ newPassword, token });
    if (error) throw toError(error.message || "Reset failed");
  }, []);

  const sendVerificationOtp = useCallback(async (email: string) => {
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
    if (error) throw toError(error.message || "Could not send verification code");
  }, []);

  const verifyEmailOtp = useCallback(async (email: string, otp: string) => {
    const { error } = await authClient.emailOtp.verifyEmail({ email, otp });
    if (error) throw toError(error.message || "Invalid or expired code");

    // Verifying establishes a real Neon Auth session immediately, so this is
    // the most reliable place to apply the role picked at signup -- not the
    // later, separate sign-in, where the sessionStorage pending role could
    // already be gone (a different tab, a closed browser, hours later). By
    // the time this account reaches /login, the profile already exists and
    // sign-in resolves it on the first try, no manual "pick a role" step.
    const pendingRole = sessionStorage.getItem(pendingRoleKey(email)) as Role | null;
    if (pendingRole) {
      const token = await getNeonToken();
      if (token) {
        try {
          await postProfile(token, { role: pendingRole });
          sessionStorage.removeItem(pendingRoleKey(email));
        } catch (err) {
          // Not fatal here -- sign-in's own resolveProfile() will retry the
          // same pending role (still in sessionStorage) as a fallback.
          console.error("[auth] Could not finish profile setup right after verification, will retry at sign-in:", err);
        }
      } else {
        console.error("[auth] Verified, but no session token was available to finish profile setup -- will retry at sign-in.");
      }
    }
  }, []);

  const completeProfile = useCallback(async (role: Role) => {
    const { token, errorDetail } = await getNeonTokenResult();
    if (!token) throw toError(`Couldn't get a session token from Neon Auth: ${errorDetail || "unknown reason"}`);
    const profile = await postProfile(token, { role });
    setNeedsRoleSetup(false);
    setUser(profile);
    return profile;
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const { error } = await authClient.changePassword({ currentPassword, newPassword });
    if (error) throw toError(error.message || "Failed to change password");
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user, isHydrating, needsRoleSetup, signIn, signUp, signOut,
      requestPasswordReset, resetPassword, sendVerificationOtp, verifyEmailOtp, completeProfile, changePassword,
    }),
    [user, isHydrating, needsRoleSetup, signIn, signUp, signOut, requestPasswordReset, resetPassword, sendVerificationOtp, verifyEmailOtp, completeProfile, changePassword],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}

export function roleHome(role: Role | string): string {
  const r = String(role || "").toLowerCase();
  return r === "owner" ? "/owner" : r === "recruiter" ? "/recruiter" : "/contractor";
}
