import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../prisma";
import { UserPayload } from "../middleware/auth";
import { normalizeEmail, normalizeName } from "../lib/normalize";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: "owner" | "recruiter" | "contractor";
  passwordHash: string;
  emailVerified: boolean;
  isActive: boolean;
  verifyToken?: string | null;
  resetToken?: string | null;
  resetTokenExpiresAt?: Date | null;
}

// Precomputed dummy hash so a login attempt against a nonexistent email still
// pays the same bcrypt.compare cost as one against a real (wrong) password --
// closes the timing side-channel that would otherwise let an attacker
// enumerate registered emails by response time.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing-safety", 12);

function toUserRecord(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  passwordHash: string;
  emailVerified: boolean;
  isActive: boolean;
  verifyToken: string | null;
  resetToken: string | null;
  resetTokenExpiresAt: Date | null;
}): UserRecord {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role.toLowerCase() as UserRecord["role"],
    passwordHash: u.passwordHash,
    emailVerified: u.emailVerified,
    isActive: u.isActive,
    verifyToken: u.verifyToken,
    resetToken: u.resetToken,
    resetTokenExpiresAt: u.resetTokenExpiresAt,
  };
}

export class AuthService {
  static hashPassword(password: string): string {
    return bcrypt.hashSync(password, 12);
  }

  static verifyPassword(password: string, hash: string): boolean {
    return bcrypt.compareSync(password, hash);
  }

  /** Always pays the same bcrypt cost whether or not a user was found. */
  static verifyPasswordTimingSafe(password: string, user: UserRecord | null): boolean {
    if (!user) {
      bcrypt.compareSync(password, DUMMY_HASH);
      return false;
    }
    return bcrypt.compareSync(password, user.passwordHash);
  }

  static generateAccessToken(user: UserPayload): string {
    return jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      config.jwtSecret,
      { expiresIn: "15m" }
    );
  }

  static async generateRefreshToken(userId: string): Promise<{ token: string; tokenHash: string }> {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: { tokenHash, userId, expiresAt },
    });
    return { token, tokenHash };
  }

  static async verifyRefreshToken(token: string): Promise<string | null> {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!record || record.revoked || record.expiresAt < new Date()) {
      return null;
    }
    return record.userId;
  }

  static async revokeRefreshToken(token: string): Promise<void> {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revoked: true },
    });
  }

  static async findUserByEmail(rawEmail: string): Promise<UserRecord | null> {
    const email = normalizeEmail(rawEmail);
    const user = await prisma.user.findUnique({ where: { email } });
    return user ? toUserRecord(user) : null;
  }

  static async findUserById(id: string): Promise<UserRecord | null> {
    const user = await prisma.user.findUnique({ where: { id } });
    return user ? toUserRecord(user) : null;
  }

  static async createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
    role: "owner" | "recruiter" | "contractor";
  }): Promise<UserRecord> {
    const verifyToken = crypto.randomBytes(16).toString("hex");
    const user = await prisma.user.create({
      data: {
        name: normalizeName(input.name),
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        role: input.role.toUpperCase() as "OWNER" | "RECRUITER" | "CONTRACTOR",
        emailVerified: false,
        isActive: true,
        verifyToken,
      },
    });
    return toUserRecord(user);
  }

  static async verifyEmailToken(token: string): Promise<UserRecord | null> {
    const user = await prisma.user.findFirst({ where: { verifyToken: token } });
    if (!user) return null;
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verifyToken: null },
    });
    return toUserRecord(updated);
  }
}
