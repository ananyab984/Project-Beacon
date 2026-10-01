import { prisma } from "../prisma";
import { normalizeEmail, normalizeName } from "../lib/normalize";

/**
 * Credentials and sessions are Neon Auth's job now (see middleware/auth.ts).
 * All that's left here is the app-profile side: role and business data,
 * linked to a Neon Auth identity by neonAuthUserId or by email.
 */
export class AuthService {
  static async findUserByEmail(rawEmail: string) {
    return prisma.user.findUnique({ where: { email: normalizeEmail(rawEmail) } });
  }

  static async findUserById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  /**
   * First authenticated call for a given Neon Auth identity: create the
   * profile row if this email has never been seen, or link an existing one
   * (e.g. an owner pre-invited this email with a role already set -- see
   * user.routes.ts's POST /api/users) if it has. Idempotent either way.
   */
  static async linkOrCreateProfile(input: {
    neonAuthUserId: string;
    email: string;
    name: string;
    emailVerified: boolean;
    role?: "owner" | "recruiter" | "contractor";
  }) {
    const email = normalizeEmail(input.email);
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { neonAuthUserId: input.neonAuthUserId, name: normalizeName(input.name), emailVerified: input.emailVerified },
      });
    }

    if (!input.role) return null;

    return prisma.user.create({
      data: {
        neonAuthUserId: input.neonAuthUserId,
        name: normalizeName(input.name),
        email,
        role: input.role.toUpperCase() as "OWNER" | "RECRUITER" | "CONTRACTOR",
        emailVerified: input.emailVerified,
        isActive: true,
      },
    });
  }
}
