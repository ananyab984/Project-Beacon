import { Request, Response, NextFunction } from "express";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { config } from "../config";
import { prisma } from "../prisma";

export interface UserPayload {
  id: string;
  email: string;
  name: string;
  role: "owner" | "recruiter" | "contractor";
}

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

const JWKS = createRemoteJWKSet(new URL(`${config.neonAuthUrl}/.well-known/jwks.json`));
const NEON_AUTH_ISSUER = new URL(config.neonAuthUrl).origin;

/**
 * This app has no auth of its own anymore -- every request is authenticated
 * by verifying a Neon Auth (Managed Better Auth) JWT against Neon's JWKS.
 * That token proves *identity* (id/email/name/emailVerified) but carries no
 * concept of our app's owner/recruiter/contractor roles -- Neon's docs are
 * explicit that "custom claims are not supported at this time" -- so role and
 * every business relationship (assignedRecruiterId, etc.) still live on our
 * own `users` table, linked to the Neon Auth identity by neonAuthUserId.
 *
 * First request after signing up: no users row has neonAuthUserId set yet,
 * so we link by email instead (covers both a brand-new signup and an
 * owner-pre-created invite row -- see user.routes.ts) and backfill the id so
 * every later request is a single indexed lookup.
 */
export type NeonIdentity = { neonUserId: string; email: string; name: string; emailVerified: boolean };

/** Verifies the bearer token is a genuine, current Neon Auth session. Nothing more -- no app-profile lookup, so this is safe to use before one exists. */
export async function verifyNeonIdentity(req: Request, res: Response): Promise<NeonIdentity | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : undefined;

  if (!token) {
    res.status(401).json({ error: "UNAUTHORIZED_NO_TOKEN", message: "Authentication required" });
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: NEON_AUTH_ISSUER });
    const neonUserId = String(payload.sub ?? payload.id ?? "");
    const email = String(payload.email ?? "");
    const name = String(payload.name ?? email);
    const emailVerified = Boolean(payload.emailVerified);
    if (!neonUserId || !email) throw new Error("Token missing sub/email");
    return { neonUserId, email, name, emailVerified };
  } catch (err: any) {
    if (err?.code === "ERR_JWT_EXPIRED") {
      res.status(401).json({ error: "UNAUTHORIZED_TOKEN_EXPIRED", message: "Session has expired" });
    } else {
      res.status(401).json({ error: "UNAUTHORIZED_INVALID_TOKEN", message: "Invalid or malformed session token" });
    }
    return null;
  }
}

export async function authenticateJwt(req: Request, res: Response, next: NextFunction) {
  const identity = await verifyNeonIdentity(req, res);
  if (!identity) return; // response already sent
  const { neonUserId, email, name } = identity;

  let profile = await prisma.user.findUnique({ where: { neonAuthUserId: neonUserId } });

  if (!profile) {
    profile = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (profile) {
      profile = await prisma.user.update({ where: { id: profile.id }, data: { neonAuthUserId: neonUserId, name } });
    }
  }

  if (!profile) {
    // A verified Neon Auth identity with no app profile yet -- neither
    // signed up through /signup's role picker nor pre-invited by an owner.
    // Distinct from a bad/expired token: the client's job here is to send
    // this person to "pick your role", not back to login.
    return res.status(404).json({
      error: "NO_PROFILE",
      message: "This account isn't set up in Global3 yet. Choose a role to finish setting up.",
      email,
    });
  }

  if (!profile.isActive) {
    return res.status(403).json({ error: "ACCOUNT_DISABLED", message: "Your account has been deactivated" });
  }

  req.user = { id: profile.id, email: profile.email, name: profile.name, role: profile.role.toLowerCase() as UserPayload["role"] };
  return next();
}
