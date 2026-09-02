import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@server-root/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "@server-root/prisma";
import { AuthService } from "@server/services/auth.service";

const mockFindUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.user.update as unknown as ReturnType<typeof vi.fn>;
const mockCreate = prisma.user.create as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("AuthService.findUserByEmail", () => {
  it("normalizes the email before looking it up", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1" });
    await AuthService.findUserByEmail("  User@Example.COM  ");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { email: "user@example.com" } });
  });
});

describe("AuthService.findUserById", () => {
  it("looks up by id directly", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1" });
    await AuthService.findUserById("u1");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "u1" } });
  });
});

describe("AuthService.linkOrCreateProfile", () => {
  it("updates and backfills neonAuthUserId when a profile already exists by email", async () => {
    mockFindUnique.mockResolvedValue({ id: "existing-1", email: "user@example.com" });
    mockUpdate.mockResolvedValue({ id: "existing-1", neonAuthUserId: "neon-1" });

    const result = await AuthService.linkOrCreateProfile({
      neonAuthUserId: "neon-1",
      email: "User@Example.com",
      name: "  Jane  ",
      emailVerified: true,
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "existing-1" },
      data: { neonAuthUserId: "neon-1", name: "Jane", emailVerified: true },
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "existing-1", neonAuthUserId: "neon-1" });
  });

  it("creates a brand-new profile when none exists and a role is provided", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "new-1" });

    await AuthService.linkOrCreateProfile({
      neonAuthUserId: "neon-2",
      email: "new@example.com",
      name: "New User",
      emailVerified: false,
      role: "recruiter",
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        neonAuthUserId: "neon-2",
        name: "New User",
        email: "new@example.com",
        role: "RECRUITER",
        emailVerified: false,
        isActive: true,
      },
    });
  });

  it("returns null (does not create) when no profile exists and no role was given", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await AuthService.linkOrCreateProfile({
      neonAuthUserId: "neon-3",
      email: "unknown@example.com",
      name: "Unknown",
      emailVerified: false,
    });
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("is idempotent: calling twice for the same existing email always updates, never creates", async () => {
    mockFindUnique.mockResolvedValue({ id: "existing-1" });
    mockUpdate.mockResolvedValue({ id: "existing-1" });
    const input = { neonAuthUserId: "neon-1", email: "user@example.com", name: "Jane", emailVerified: true, role: "owner" as const };
    await AuthService.linkOrCreateProfile(input);
    await AuthService.linkOrCreateProfile(input);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });
});
