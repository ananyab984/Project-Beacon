import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";

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

export function authenticateJwt(req: Request, res: Response, next: NextFunction) {
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

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as UserPayload;
    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "UNAUTHORIZED_TOKEN_EXPIRED", message: "Access token has expired" });
    }
    return res.status(401).json({ error: "UNAUTHORIZED_INVALID_TOKEN", message: "Invalid access token" });
  }
}
