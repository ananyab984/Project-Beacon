import { Request, Response, NextFunction } from "express";

export type Role = "owner" | "recruiter" | "contractor";

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "Authentication required" });
    }

    const normalizedRole = req.user.role.toLowerCase() as Role;
    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(403).json({
        error: "FORBIDDEN_INSUFFICIENT_ROLE",
        message: `Role '${req.user.role}' is not authorized to access this resource`,
      });
    }

    next();
  };
}

export const VISIBILITY_RULES: Record<Role, { accessLevel: "FULL" | "SEARCH_ONLY" | "OWN_ONLY"; notes: string }> = {
  owner: {
    accessLevel: "FULL",
    notes: "Owner has unrestricted full access across all lead pools and administrative settings.",
  },
  recruiter: {
    accessLevel: "FULL",
    notes: "Recruiters have full access to their assigned/claimed leads and promoted global leads.",
  },
  contractor: {
    accessLevel: "SEARCH_ONLY",
    notes: "Contractors can only perform existence duplicate searches; cannot view full lead details.",
  },
};
