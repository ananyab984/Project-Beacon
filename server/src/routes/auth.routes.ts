import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../prisma";
import { AuthService } from "../services/auth.service";
import { authenticateJwt, UserPayload } from "../middleware/auth";
import { normalizeEmail, normalizeName, validateEmailFormat, validateNameLength } from "../lib/normalize";

export const authRouter = Router();

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// POST /api/auth/login
authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "MISSING_CREDENTIALS", message: "Email and password are required" });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await AuthService.findUserByEmail(normalizedEmail);

    // Timing-safe: always pays the bcrypt cost, whether or not the user exists.
    if (!AuthService.verifyPasswordTimingSafe(password, user)) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    }

    if (!user!.isActive) {
      return res.status(403).json({ error: "ACCOUNT_DISABLED", message: "Your account has been deactivated" });
    }

    const payload: UserPayload = { id: user!.id, email: user!.email, name: user!.name, role: user!.role };
    const accessToken = AuthService.generateAccessToken(payload);
    const { token: refreshToken } = await AuthService.generateRefreshToken(user!.id);

    res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTS);

    return res.json({
      message: "Login successful",
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        role: user!.role.toLowerCase() as "owner" | "recruiter" | "contractor",
        emailVerified: user!.emailVerified,
      },
      accessToken,
    });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong during login" });
  }
});

// POST /api/auth/signup
authRouter.post("/signup", async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body || {};

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Name, email, password, and role are required" });
    }

    if (!["owner", "recruiter", "contractor"].includes(String(role).toLowerCase())) {
      return res.status(400).json({ error: "INVALID_ROLE", message: "Role must be owner, recruiter, or contractor" });
    }

    const normalizedEmail = normalizeEmail(email);
    if (!validateEmailFormat(normalizedEmail)) {
      return res.status(400).json({ error: "INVALID_EMAIL", message: "Please provide a valid email address" });
    }

    const normalizedName = normalizeName(name);
    if (!validateNameLength(normalizedName)) {
      return res.status(400).json({ error: "INVALID_NAME", message: "Name must be between 1 and 80 characters" });
    }

    const existing = await AuthService.findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: "USER_EXISTS", message: "An account with that email already exists" });
    }

    const passwordHash = AuthService.hashPassword(password);
    const user = await AuthService.createUser({
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
      role: String(role).toLowerCase() as "owner" | "recruiter" | "contractor",
    });

    const payload: UserPayload = { id: user.id, email: user.email, name: user.name, role: user.role };
    const accessToken = AuthService.generateAccessToken(payload);
    const { token: refreshToken } = await AuthService.generateRefreshToken(user.id);
    res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTS);

    return res.status(201).json({
      message: "User registered successfully",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.toLowerCase() as "owner" | "recruiter" | "contractor",
        emailVerified: user.emailVerified,
      },
      accessToken,
      verifyToken: user.verifyToken,
    });
  } catch (err: any) {
    // Unique-constraint race (two signups for the same email at once)
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "USER_EXISTS", message: "An account with that email already exists" });
    }
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong during signup" });
  }
});

// GET /api/auth/me
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

// POST /api/auth/refresh
authRouter.post("/refresh", async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({ error: "MISSING_REFRESH_TOKEN", message: "Refresh token is required" });
    }

    const userId = await AuthService.verifyRefreshToken(refreshToken);
    if (!userId) {
      return res.status(401).json({ error: "INVALID_REFRESH_TOKEN", message: "Refresh token is invalid or expired" });
    }

    const user = await AuthService.findUserById(userId);
    if (!user) {
      return res.status(404).json({ error: "USER_NOT_FOUND", message: "User not found" });
    }

    // Rotate refresh token
    await AuthService.revokeRefreshToken(refreshToken);
    const { token: newRefreshToken } = await AuthService.generateRefreshToken(user.id);
    const payload: UserPayload = { id: user.id, email: user.email, name: user.name, role: user.role };
    const accessToken = AuthService.generateAccessToken(payload);

    res.cookie("refreshToken", newRefreshToken, REFRESH_COOKIE_OPTS);

    return res.json({ accessToken });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong during refresh" });
  }
});

// POST /api/auth/logout
authRouter.post("/logout", async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (refreshToken) {
      await AuthService.revokeRefreshToken(refreshToken);
    }
    res.clearCookie("refreshToken");
    return res.json({ message: "Logged out successfully" });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong during logout" });
  }
});

// POST /api/auth/verify-email
authRouter.post("/verify-email", async (req: Request, res: Response) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ error: "MISSING_TOKEN", message: "Verification token is required" });
    }

    const user = await AuthService.verifyEmailToken(token);
    if (!user) {
      return res.status(400).json({ error: "INVALID_TOKEN", message: "Verification token is invalid or already used" });
    }

    return res.json({
      message: "Email verified successfully",
      user: { id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified },
    });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong during verification" });
  }
});

// PATCH /api/auth/me
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
        role: user.role,
        emailVerified: user.emailVerified,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong updating your profile" });
  }
});

// POST /api/auth/change-password
authRouter.post("/change-password", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Current and new password are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "INVALID_PASSWORD", message: "New password must be at least 8 characters" });
    }

    const user = await AuthService.findUserById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: "USER_NOT_FOUND", message: "User not found" });
    }

    if (!AuthService.verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: "INVALID_CURRENT_PASSWORD", message: "Current password is incorrect" });
    }

    const passwordHash = AuthService.hashPassword(newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    return res.json({ message: "Password changed successfully" });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong changing your password" });
  }
});

// POST /api/auth/forgot-password
authRouter.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Email is required" });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await AuthService.findUserByEmail(normalizedEmail);

    if (!user) {
      // Don't leak account existence.
      return res.json({ message: "If that email exists, a reset link has been sent" });
    }

    const resetToken = crypto.randomBytes(16).toString("hex");
    const resetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiresAt },
    });

    return res.json({ message: "If that email exists, a reset link has been sent", resetToken });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong during password reset request" });
  }
});

// POST /api/auth/reset-password
authRouter.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Token and new password are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "INVALID_PASSWORD", message: "New password must be at least 8 characters" });
    }

    const user = await prisma.user.findFirst({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt <= new Date()) {
      return res.status(400).json({ error: "INVALID_OR_EXPIRED_TOKEN", message: "Reset token is invalid or expired" });
    }

    const passwordHash = AuthService.hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiresAt: null },
    });

    return res.json({ message: "Password reset successfully" });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong during password reset" });
  }
});

// POST /api/auth/resend-verification
authRouter.post("/resend-verification", async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Email is required" });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await AuthService.findUserByEmail(normalizedEmail);
    if (!user) {
      // Don't leak account existence.
      return res.json({ message: "If that email exists, a verification link has been sent" });
    }
    if (user.emailVerified) {
      return res.json({ message: "This account is already verified" });
    }

    const verifyToken = crypto.randomBytes(16).toString("hex");
    await prisma.user.update({ where: { id: user.id }, data: { verifyToken } });

    return res.json({ message: "If that email exists, a verification link has been sent", verifyToken });
  } catch (err) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong resending verification" });
  }
});
