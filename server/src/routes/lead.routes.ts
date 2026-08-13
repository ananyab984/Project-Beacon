import { Router, Request, Response } from "express";
import { authenticateJwt } from "../middleware/auth";
import { requireRole, VISIBILITY_RULES, Role } from "../middleware/rbac";

export const leadRouter = Router();

// All lead routes require authentication
leadRouter.use(authenticateJwt);

// GET /api/leads — Full leads access for Owner and Recruiter
leadRouter.get("/", requireRole("owner", "recruiter"), (req: Request, res: Response) => {
  const role = req.user!.role.toLowerCase() as Role;
  const visibility = VISIBILITY_RULES[role];

  return res.json({
    message: `Access granted for role '${role}'`,
    accessLevel: visibility.accessLevel,
    rules: visibility.notes,
    leads: [
      { id: "lead_101", fullName: "Tammy Pérez", source: "Ada", status: "ENRICHED" },
      { id: "lead_102", fullName: "Alex Chen", source: "LinkedIn", status: "ENRICHED" },
    ],
  });
});

// GET /api/leads/global — Global lead pool access
leadRouter.get("/global", requireRole("owner", "recruiter"), (req: Request, res: Response) => {
  const role = req.user!.role.toLowerCase() as Role;

  return res.json({
    message: `Global Lead Pool access granted for role '${role}'`,
    gateEnforced: role === "recruiter" ? "enrichmentStatus === COMPLETE" : "NONE",
    leads: [
      { id: "lead_201", fullName: "Elena Rostova", source: "ProZ", enrichmentStatus: "COMPLETE" },
    ],
  });
});

// POST /api/leads/check-duplicate — SEARCH_ONLY access (Contractors + Recruiters + Owner)
leadRouter.post("/check-duplicate", requireRole("owner", "recruiter", "contractor"), (req: Request, res: Response) => {
  const { email, contactNumber, fullName } = req.body || {};
  const role = req.user!.role.toLowerCase() as Role;
  const visibility = VISIBILITY_RULES[role];

  return res.json({
    message: `Duplicate check search executed under accessLevel '${visibility.accessLevel}'`,
    isDuplicate: false,
    matchedField: null,
    confidence: 0.0,
  });
});
