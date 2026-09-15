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
    accessLevel: "OWN_ONLY",
    // Stale as of the contractor/recruiter parity work: contractors now have
    // full CRUD-ish access to leads THEY created (view, edit, flag, log
    // activity, retry/re-enrich, message via Conversations/Email Queue,
    // bulk stage-change/delete their own batch) -- never leads created by
    // someone else, never the Global Leads pool, never Client identity.
    // "Existence duplicate searches" only describes the create-time
    // duplicate-detection check now, not this role's actual data access.
    notes: "Contractors have full access to leads they created themselves -- never someone else's leads, the Global Leads pool, or Client identity/data.",
  },
};
