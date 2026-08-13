// Seeds the same 3 demo users the client's mock auth (client/src/lib/auth.tsx)
// and the old in-memory AuthService both used, so the existing manual-test
// flow (owner@global3.co / recruiter@global3.co / contractor@global3.co, all
// password "demo1234") keeps working once auth is backed by real Postgres.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_USERS = [
  { name: "Owner User", email: "owner@global3.co", role: "OWNER" as const },
  { name: "Recruiter User", email: "recruiter@global3.co", role: "RECRUITER" as const },
  { name: "Contractor Partner", email: "contractor@global3.co", role: "CONTRACTOR" as const },
];

async function main() {
  const passwordHash = bcrypt.hashSync("demo1234", 12);

  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        passwordHash,
        emailVerified: true,
        isActive: true,
      },
    });
    console.log(`Seeded ${u.email}`);
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
