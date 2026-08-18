import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Role = "owner" | "recruiter" | "contractor";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
};

type StoredUser = AuthUser & {
  password: string;
  verifyToken?: string | null;
  resetToken?: string | null;
  resetExpiresAt?: number | null;
};

type Session = { userId: string; issuedAt: number; accessToken?: string };

const USERS_KEY = "g3.users.v2";
const SESSION_KEY = "g3.session.v2";
const API_BASE_URL = `${import.meta.env.VITE_API_BASE_URL || "http://localhost:5001"}/api/auth`;

const seedUsers: StoredUser[] = [
  {
    id: "u_owner",
    email: "owner@global3.co",
    name: "Owner User",
    role: "owner",
    password: "demo1234",
    emailVerified: true,
  },
  {
    id: "u_recruiter",
    email: "recruiter@global3.co",
    name: "Recruiter User",
    role: "recruiter",
    password: "demo1234",
    emailVerified: true,
  },
  {
    id: "u_contractor",
    email: "contractor@global3.co",
    name: "Contractor Partner",
    role: "contractor",
    password: "demo1234",
    emailVerified: true,
  },
];

function loadUsers(): StoredUser[] {
  if (typeof window === "undefined") return seedUsers;
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    if (!raw) {
      window.localStorage.setItem(USERS_KEY, JSON.stringify(seedUsers));
      return seedUsers;
    }
    return JSON.parse(raw) as StoredUser[];
  } catch {
    return seedUsers;
  }
}

function saveUsers(users: StoredUser[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null) {
  if (typeof window === "undefined") return;
  if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else window.localStorage.removeItem(SESSION_KEY);
}

function token(len = 24) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function toPublic(u: StoredUser): AuthUser {
  const { password: _p, verifyToken: _v, resetToken: _r, resetExpiresAt: _e, ...pub } = u;
  return pub;
}

export function roleHome(role: Role | string): string {
  const r = String(role || "").toLowerCase();
  return r === "owner" ? "/owner" : r === "recruiter" ? "/recruiter" : "/contractor";
}

type AuthCtx = {
  user: AuthUser | null;
  isHydrating: boolean;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (input: {
    name: string;
    email: string;
    password: string;
    role: Role;
  }) => Promise<{ user: AuthUser; verifyToken: string }>;
  signOut: () => void;
  requestPasswordReset: (email: string) => Promise<string>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<AuthUser>;
  resendVerification: (email: string) => Promise<string>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);

  useEffect(() => {
    const s = loadSession();
    if (s && s.accessToken) {
      // Try verifying session with Node JWT server
      fetch(`${API_BASE_URL}/me`, {
        headers: { Authorization: `Bearer ${s.accessToken}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            setUser(data.user);
          } else {
            fallbackLocalHydration(s);
          }
        })
        .catch(() => fallbackLocalHydration(s))
        .finally(() => setIsHydrating(false));
    } else if (s) {
      fallbackLocalHydration(s);
      setIsHydrating(false);
    } else {
      setIsHydrating(false);
    }
  }, []);

  const fallbackLocalHydration = (s: Session) => {
    const users = loadUsers();
    const u = users.find((x) => x.id === s.userId);
    if (u) setUser(toPublic(u));
    else saveSession(null);
  };

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (res.ok && data.user && data.accessToken) {
        const s: Session = { userId: data.user.id, issuedAt: Date.now(), accessToken: data.accessToken };
        saveSession(s);
        setUser(data.user);
        return data.user;
      } else if (data && data.message) {
        throw new Error(data.message);
      }
    } catch (err: any) {
      if (err.message && !err.message.includes("fetch")) {
        throw err;
      }
    }

    // Local mock fallback if server offline
    const users = loadUsers();
    const u = users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u || u.password !== password) throw new Error("Invalid email or password");
    const s: Session = { userId: u.id, issuedAt: Date.now(), accessToken: "demo_token_" + u.id };
    saveSession(s);
    const pub = toPublic(u);
    setUser(pub);
    return pub;
  }, []);

  const signUp = useCallback<AuthCtx["signUp"]>(async ({ name, email, password, role }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        if (data.accessToken) {
          saveSession({ userId: data.user.id, issuedAt: Date.now(), accessToken: data.accessToken });
          setUser(data.user);
        }
        return { user: data.user, verifyToken: data.verifyToken || token() };
      } else if (data && data.message) {
        throw new Error(data.message);
      }
    } catch (err: any) {
      if (err.message && !err.message.includes("fetch")) {
        throw err;
      }
    }

    const users = loadUsers();
    const normalized = email.trim().toLowerCase();
    if (users.some((x) => x.email.toLowerCase() === normalized))
      throw new Error("An account with that email already exists");
    const verifyToken = token();
    const nu: StoredUser = {
      id: `u_${token(10)}`,
      email: normalized,
      name: name.trim(),
      role,
      password,
      emailVerified: false,
      verifyToken,
    };
    saveUsers([...users, nu]);
    const pub = toPublic(nu);
    saveSession({ userId: nu.id, issuedAt: Date.now(), accessToken: "demo_token_" + nu.id });
    setUser(pub);
    return { user: pub, verifyToken };
  }, []);

  const signOut = useCallback(() => {
    const s = loadSession();
    if (s && s.accessToken) {
      fetch(`${API_BASE_URL}/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${s.accessToken}`,
        },
      }).catch(() => {});
    }
    saveSession(null);
    setUser(null);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        // Server never leaks whether the account exists, but does return the
        // raw token for now (no email-sending infra yet) when it does.
        if (data.resetToken) return data.resetToken;
        throw new Error("If that email exists, a reset link has been sent");
      } else if (data?.message) {
        throw new Error(data.message);
      }
    } catch (err: any) {
      if (err.message && !err.message.includes("fetch")) throw err;
    }

    // Local mock fallback if server offline
    const users = loadUsers();
    const idx = users.findIndex((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (idx === -1) throw new Error("No account found for that email");
    const t = token();
    users[idx] = { ...users[idx], resetToken: t, resetExpiresAt: Date.now() + 30 * 60 * 1000 };
    saveUsers(users);
    return t;
  }, []);

  const resetPassword = useCallback(async (t: string, newPassword: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: t, newPassword }),
      });
      const data = await res.json();
      if (res.ok) return;
      if (data?.message) throw new Error(data.message);
    } catch (err: any) {
      if (err.message && !err.message.includes("fetch")) throw err;
    }

    // Local mock fallback if server offline
    const users = loadUsers();
    const idx = users.findIndex((x) => x.resetToken === t);
    if (idx === -1) throw new Error("Invalid or expired reset link");
    const u = users[idx];
    if (!u.resetExpiresAt || u.resetExpiresAt < Date.now()) throw new Error("Reset link has expired");
    users[idx] = { ...u, password: newPassword, resetToken: null, resetExpiresAt: null };
    saveUsers(users);
  }, []);

  const verifyEmail = useCallback(async (t: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: t }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        setUser((cur) => (cur && cur.id === data.user.id ? data.user : cur));
        return data.user as AuthUser;
      } else if (data?.message) {
        throw new Error(data.message);
      }
    } catch (err: any) {
      if (err.message && !err.message.includes("fetch")) throw err;
    }

    // Local mock fallback if server offline
    const users = loadUsers();
    const idx = users.findIndex((x) => x.verifyToken === t);
    if (idx === -1) throw new Error("Invalid verification link");
    users[idx] = { ...users[idx], emailVerified: true, verifyToken: null };
    saveUsers(users);
    const pub = toPublic(users[idx]);
    setUser((cur) => (cur && cur.id === pub.id ? pub : cur));
    return pub;
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.verifyToken) return data.verifyToken;
        throw new Error("If that email exists, a verification link has been sent");
      } else if (data?.message) {
        throw new Error(data.message);
      }
    } catch (err: any) {
      if (err.message && !err.message.includes("fetch")) throw err;
    }

    // Local mock fallback if server offline
    const users = loadUsers();
    const idx = users.findIndex((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (idx === -1) throw new Error("No account found for that email");
    const t = token();
    users[idx] = { ...users[idx], verifyToken: t };
    saveUsers(users);
    return t;
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const s = loadSession();
    if (!s?.accessToken) throw new Error("You must be signed in to change your password");
    const res = await fetch(`${API_BASE_URL}/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.accessToken}` },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to change password");
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      isHydrating,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      resetPassword,
      verifyEmail,
      resendVerification,
      changePassword,
    }),
    [user, isHydrating, signIn, signUp, signOut, requestPasswordReset, resetPassword, verifyEmail, resendVerification, changePassword],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
