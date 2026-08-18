// Seeds the same 3 demo users the client's mock auth (client/src/lib/auth.tsx)
// and the old in-memory AuthService both used, so the existing manual-test
// flow (owner@global3.co / recruiter@global3.co / contractor@global3.co, all
// password "demo1234") keeps working once auth is backed by real Postgres.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_USERS = [
  { name: "Owner User", email: "owner@global3.co", role: "OWNER" as const, languages: [] },
  { name: "Recruiter User", email: "recruiter@global3.co", role: "RECRUITER" as const, languages: [] },
  { name: "Contractor Partner", email: "contractor@global3.co", role: "CONTRACTOR" as const, languages: [] },
];

async function main() {
  const passwordHash = bcrypt.hashSync("demo1234", 12);

  // Clean up any old synthetic dummy accounts and their dependent rows
  const dummyEmails = ["mathu@global3.co", "divya@global3.co", "varsha@global3.co", "sharmistha@global3.co", "sunaina@global3.co"];
  const dummyUsers = await prisma.user.findMany({ where: { email: { in: dummyEmails } }, select: { id: true } });
  const dummyIds = dummyUsers.map(u => u.id);

  if (dummyIds.length > 0) {
    const snapshots = await prisma.recruiterScoreSnapshot.findMany({
      where: { recruiterId: { in: dummyIds } },
      select: { id: true },
    });
    const snapshotIds = snapshots.map(s => s.id);
    if (snapshotIds.length > 0) {
      await prisma.recruiterMetricSnapshot.deleteMany({ where: { scoreSnapshotId: { in: snapshotIds } } });
      await prisma.recruiterScoreSnapshot.deleteMany({ where: { id: { in: snapshotIds } } });
    }
    await prisma.recruiterKpiSummary.deleteMany({ where: { recruiterId: { in: dummyIds } } });
    await prisma.requirement.updateMany({ where: { recruiterId: { in: dummyIds } }, data: { recruiterId: null } });
    await prisma.user.deleteMany({ where: { id: { in: dummyIds } } });
    console.log(`Cleaned up ${dummyIds.length} synthetic dummy accounts.`);
  }

  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
      },
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        languages: u.languages,
        passwordHash,
        emailVerified: true,
        isActive: true,
      },
    });
    console.log(`Seeded user ${u.name} (${u.email}) [${u.role}]`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
