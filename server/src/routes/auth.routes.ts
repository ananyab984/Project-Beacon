import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthService } from "../services/auth.service";
import { authenticateJwt, verifyNeonIdentity } from "../middleware/auth";
import { normalizeName, validateNameLength } from "../lib/normalize";

/**
 * Credentials, sessions, and email verification are all Neon Auth's job now
 * -- the client talks to Neon Auth directly for sign up / sign in / sign out
 * / verify / password reset, never through this server. All that's left here
 * is the app-profile side: role, and everything that role gates.
 */
export const authRouter = Router();

// GET /api/auth/me — resolve the caller's app profile from their Neon Auth
// session. 404 NO_PROFILE (via authenticateJwt) means "verified with Neon,
// but hasn't finished setting up here yet" -- the client sends those to the
// role picker rather than treating it as a bad session.
authRouter.get("/me", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const user = await AuthService.findUserById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: "USER_NOT_FOUND", message: "User profile not found" });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.toLowerCase() as "owner" | "recruiter" | "contractor",
        emailVerified: user.emailVerified,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong" });
  }
});

// POST /api/auth/profile — finishes setup for a Neon Auth identity that has
// no app profile yet. Two callers reach this: (1) someone who just verified
// and picked a role on /signup, and (2) someone an owner already pre-invited
// by email (see user.routes.ts) signing in with Neon Auth for the first time
// -- in that case `role` is optional since the invite already set it.
authRouter.post("/profile", async (req: Request, res: Response) => {
  const identity = await verifyNeonIdentity(req, res);
  if (!identity) return; // response already sent

  try {
    const schema = z.object({ name: z.string().min(1).max(80).optional(), role: z.enum(["owner", "recruiter", "contractor"]).optional() });
    const { name, role } = schema.parse(req.body ?? {});

    const user = await AuthService.linkOrCreateProfile({
      neonAuthUserId: identity.neonUserId,
      email: identity.email,
      name: name ?? identity.name,
      emailVerified: identity.emailVerified,
      role,
    });

    if (!user) {
      return res.status(400).json({
        error: "ROLE_REQUIRED",
        message: "No existing invite found for this email -- choose a role to finish setting up.",
      });
    }

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.toLowerCase() as "owner" | "recruiter" | "contractor",
        emailVerified: user.emailVerified,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong setting up your profile" });
  }
});

// PATCH /api/auth/me — profile name edit (password/email changes go through Neon Auth directly)
authRouter.patch("/me", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { name } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Name is required" });
    }

    const normalizedName = normalizeName(name);
    if (!validateNameLength(normalizedName)) {
      return res.status(400).json({ error: "INVALID_NAME", message: "Name must be between 1 and 80 characters" });
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { name: normalizedName },
    });

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.toLowerCase() as "owner" | "recruiter" | "contractor",
        emailVerified: user.emailVerified,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong updating your profile" });
  }
});
