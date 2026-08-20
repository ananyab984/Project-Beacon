import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole, Role } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { normalizeEmail, normalizeName, validateEmailFormat, validateNameLength } from "../lib/normalize";

export const userRouter = Router();

userRouter.use(authenticateJwt);

const USER_ROLES = ["RECRUITER", "CONTRACTOR"] as const;
const WORK_STATUSES = ["PERMANENT", "CONTRACTOR"] as const;

const createUserSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  role: z.enum(USER_ROLES),
  workStatus: z.enum(WORK_STATUSES).optional(),
  languages: z.array(z.string()).optional(),
});

const languagesSchema = z.object({
  languages: z.array(z.string()),
});

const contractorAssignmentSchema = z.object({
  recruiterId: z.string().uuid().optional(),
});

// Fields safe to return to callers -- never the password hash.
const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  workStatus: true,
  languages: true,
  emailVerified: true,
  isActive: true,
  startDate: true,
  createdAt: true,
  connectedAccounts: {
    select: {
      id: true,
      provider: true,
      accountName: true,
      status: true,
      unipileAccountId: true,
    },
  },
} as const;

// GET /api/users?role=RECRUITER|CONTRACTOR — owner sees the full roster;
// recruiters can list both (recruiter roster for the leads/requirement
// assignment dropdowns, contractor roster for the "Contractors" oversight
// page -- "any recruiter can view any contractor's activity" per the access
// model). Contractors themselves cannot list the roster.
userRouter.get(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({ role: z.enum(USER_ROLES) });
    const { role } = schema.parse({ role: String(req.query.role ?? "").toUpperCase() });

    const users = await prisma.user.findMany({
      where: { role },
      select: SAFE_USER_SELECT,
      orderBy: { name: "asc" },
    });

    if (role !== "CONTRACTOR") {
      return res.json({ users });
    }

    // Left-join assignment status for contractors so the client can show
    // "assigned to me" vs "available".
    const assignments = await prisma.contractorAssignment.findMany({
      where: { contractorId: { in: users.map((u) => u.id) } },
      select: { contractorId: true, recruiterId: true },
    });
    const assignmentByContractorId = new Map(assignments.map((a) => [a.contractorId, a.recruiterId]));

    const usersWithAssignment = users.map((u) => ({
      ...u,
      managingRecruiterId: assignmentByContractorId.get(u.id) ?? null,
    }));

    return res.json({ users: usersWithAssignment });
  })
);

// POST /api/users — owner-only, reserves a recruiter or contractor role for an
// email address. Credentials live in Neon Auth, not here: this just pre-seeds
// the app profile so that whenever this person actually signs up/signs in
// through Neon Auth, POST /api/auth/profile links to this row by email
// instead of asking them to pick a role themselves.
userRouter.post(
  "/",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createUserSchema.parse(req.body);

    const normalizedEmail = normalizeEmail(parsed.email);
    if (!validateEmailFormat(normalizedEmail)) {
      throw new ApiError(400, "INVALID_EMAIL", "Please provide a valid email address");
    }

    const normalizedName = normalizeName(parsed.name);
    if (!validateNameLength(normalizedName)) {
      throw new ApiError(400, "INVALID_NAME", "Name must be between 1 and 80 characters");
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new ApiError(409, "USER_EXISTS", "An account with that email already exists");
    }

    const user = await prisma.user.create({
      data: {
        name: normalizedName,
        email: normalizedEmail,
        role: parsed.role,
        workStatus: parsed.workStatus ?? "PERMANENT",
        languages: parsed.languages ?? [],
        emailVerified: false,
        isActive: true,
      },
      select: SAFE_USER_SELECT,
    });

    return res.status(201).json({ user });
  })
);

// DELETE /api/users/:id — owner-only soft delete
userRouter.delete(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "USER_NOT_FOUND", "User not found");

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false },
      select: SAFE_USER_SELECT,
    });

    return res.json({ user });
  })
);

// PATCH /api/users/:id/languages — owner (any user) or the user themself
userRouter.patch(
  "/:id/languages",
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role.toLowerCase() as Role;
    if (role !== "owner" && req.user!.id !== req.params.id) {
      throw new ApiError(403, "FORBIDDEN", "You can only update your own languages");
    }

    const { languages } = languagesSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "USER_NOT_FOUND", "User not found");

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { languages },
      select: SAFE_USER_SELECT,
    });

    return res.json({ user });
  })
);

// POST /api/users/:id/contractor-assignment — recruiter/owner assigns a contractor
userRouter.post(
  "/:id/contractor-assignment",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role.toLowerCase() as Role;
    const { recruiterId } = contractorAssignmentSchema.parse(req.body ?? {});

    const targetRecruiterId = role === "owner" && recruiterId ? recruiterId : req.user!.id;

    const contractor = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!contractor || contractor.role !== "CONTRACTOR") {
      throw new ApiError(404, "CONTRACTOR_NOT_FOUND", "Contractor not found");
    }

    const assignment = await prisma.contractorAssignment.upsert({
      where: { contractorId: req.params.id },
      create: { contractorId: req.params.id, recruiterId: targetRecruiterId },
      update: { recruiterId: targetRecruiterId, assignedAt: new Date() },
    });

    return res.status(201).json({ assignment });
  })
);

// DELETE /api/users/:id/contractor-assignment — recruiter/owner unassigns a contractor
userRouter.delete(
  "/:id/contractor-assignment",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    await prisma.contractorAssignment.deleteMany({ where: { contractorId: req.params.id } });
    return res.json({ message: "Contractor unassigned" });
  })
);
