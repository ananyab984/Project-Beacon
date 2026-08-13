import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
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

export async function authenticateJwt(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({ error: "UNAUTHORIZED_NO_TOKEN", message: "Authentication required" });
  }

  // Handle dev demo tokens by matching the exact userId
  if (token.startsWith("demo_token_")) {
    const userId = token.replace("demo_token_", "");
    const dbUser = await prisma.user.findUnique({ where: { id: userId } }).catch(() => null);
    if (dbUser) {
      req.user = {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role.toLowerCase() as any,
      };
      return next();
    }
    return res.status(401).json({ error: "UNAUTHORIZED_USER_NOT_FOUND", message: "User not found for session" });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as UserPayload;
    req.user = decoded;
    return next();
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "UNAUTHORIZED_TOKEN_EXPIRED", message: "Access token has expired" });
    }
    return res.status(401).json({ error: "UNAUTHORIZED_INVALID_TOKEN", message: "Invalid access token" });
  }
}
