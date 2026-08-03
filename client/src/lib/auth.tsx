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

type Session = { userId: string; issuedAt: number };

const USERS_KEY = "g3.users.v2";
const SESSION_KEY = "g3.session.v2";

const seedUsers: StoredUser[] = [
  {
    id: "u_owner",
    email: "ethan@global3.co",
    name: "Ethan",
    role: "owner",
    password: "demo1234",
    emailVerified: true,
  },
  {
    id: "u_recruiter",
    email: "riya@global3.co",
    name: "Riya Shah",
    role: "recruiter",
    password: "demo1234",
    emailVerified: true,
  },
  {
    id: "u_contractor",
    email: "alex@global3.co",
    name: "Alex Kim",
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

export function roleHome(role: Role): string {
  return role === "owner" ? "/owner" : role === "recruiter" ? "/recruiter" : "/contractor";
}

type AuthCtx = {
  user: AuthUser | null;
  isHydrating: boolean;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (input: {
    name: string;
    email: string;
    password: string;
    role: Exclude<Role, "owner">;
  }) => Promise<{ user: AuthUser; verifyToken: string }>;
  signOut: () => void;
  requestPasswordReset: (email: string) => Promise<string>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<AuthUser>;
  resendVerification: (email: string) => Promise<string>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);

  useEffect(() => {
    const users = loadUsers();
    const s = loadSession();
    if (s) {
      const u = users.find((x) => x.id === s.userId);
      if (u) setUser(toPublic(u));
      else saveSession(null);
    }
    setIsHydrating(false);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const users = loadUsers();
    const u = users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u || u.password !== password) throw new Error("Invalid email or password");
    const s: Session = { userId: u.id, issuedAt: Date.now() };
    saveSession(s);
    const pub = toPublic(u);
    setUser(pub);
    return pub;
  }, []);

  const signUp = useCallback<AuthCtx["signUp"]>(async ({ name, email, password, role }) => {
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
    return { user: toPublic(nu), verifyToken };
  }, []);

  const signOut = useCallback(() => {
    saveSession(null);
    setUser(null);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const users = loadUsers();
    const idx = users.findIndex((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (idx === -1) throw new Error("No account found for that email");
    const t = token();
    users[idx] = { ...users[idx], resetToken: t, resetExpiresAt: Date.now() + 30 * 60 * 1000 };
    saveUsers(users);
    return t;
  }, []);

  const resetPassword = useCallback(async (t: string, newPassword: string) => {
    const users = loadUsers();
    const idx = users.findIndex((x) => x.resetToken === t);
    if (idx === -1) throw new Error("Invalid or expired reset link");
    const u = users[idx];
    if (!u.resetExpiresAt || u.resetExpiresAt < Date.now()) throw new Error("Reset link has expired");
    users[idx] = { ...u, password: newPassword, resetToken: null, resetExpiresAt: null };
    saveUsers(users);
  }, []);

  const verifyEmail = useCallback(async (t: string) => {
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
    const users = loadUsers();
    const idx = users.findIndex((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (idx === -1) throw new Error("No account found for that email");
    const t = token();
    users[idx] = { ...users[idx], verifyToken: t };
    saveUsers(users);
    return t;
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
    }),
    [user, isHydrating, signIn, signUp, signOut, requestPasswordReset, resetPassword, verifyEmail, resendVerification],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
