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

const FAQ_ENTRIES: { id: string; category: string; question: string; answer: string; tags: string[] }[] = [
  {
    id: "faq_confidentiality_assets",
    category: "General",
    question: "What are Global3's confidentiality guidelines around client assets?",
    answer:
      "Global3 works with premium studios and clients. The assets loaded in our system, if leaked, could expose significant financial and brand risk. While we trust our freelancers as professionals committed to high ethical standards, we're bound to strong guidelines against anything that could harm our clients' assets.",
    tags: ["confidentiality", "nda", "assets"],
  },
  {
    id: "faq_voice_training_duration",
    category: "Voice Cloning Training",
    question: "How long is the training session on July 28 or 29 expected to last? More than an hour?",
    answer:
      "The training is expected to take 1 hour or less. However, we want to be prepared for questions or live practice together, so please set aside 2 hours for the same.",
    tags: ["training", "schedule"],
  },
  {
    id: "faq_voice_training_payment",
    category: "Voice Cloning Training",
    question: "Is the $500 payment meant to cover both the training and the creation of one voice model only, or does it also include the second model?",
    answer: "Training + 1st voice model is $500. The second voice model will be an additional $500.",
    tags: ["payment", "rate", "voice model"],
  },
  {
    id: "faq_voice_training_audio_material",
    category: "Voice Cloning Training",
    question: "Will you be providing the audio material for the trainers to base the voice clones on?",
    answer: "Confirming that the project will be set up within the Global3 platform for you to create the voice models.",
    tags: ["training", "voice model"],
  },
  {
    id: "faq_voice_training_tools",
    category: "Voice Cloning Training",
    question: "Are there specific tools or platforms we'll be using for the cloning process, or is that up to us?",
    answer:
      "You will be using the Global3 platform to create the voice models. Please go through the Learning platform and Training Task on G3 to get familiar with the tool. We'll also be running regular DUB creation training over the next week -- please join, as it'll help you understand the audio generation process within Global3 for the task between 11th August and end of the month. Additional details will follow in a separate email.",
    tags: ["training", "tools", "platform"],
  },
  {
    id: "faq_voice_training_delivery_format",
    category: "Voice Cloning Training",
    question: "What format and delivery method should we use for submitting the voice models?",
    answer: "The voices have to be saved within the Global3 platform. The process will be showcased during the upcoming training.",
    tags: ["delivery", "voice model"],
  },
  {
    id: "faq_voice_training_qc_volume_deadline",
    category: "Voice Cloning Training",
    question: "Do you have a rough estimate of how many videos or how much content I'll be reviewing for QC/QA starting August 11? What's the deadline for the job?",
    answer:
      "We would expect around 10 minutes of runtime video to be worked on per day. It depends on the content and the speed with which you can complete the task -- this process involves creation of the dubbed audio and QC.",
    tags: ["qc", "workload", "deadline"],
  },
  {
    id: "faq_voice_training_qc_pay_unit",
    category: "Voice Cloning Training",
    question: "Will the QC tasks be paid per hour or per runtime minute?",
    answer: "The rates will be confirmed next week.",
    tags: ["qc", "rate", "payment"],
  },
  {
    id: "faq_voice_training_availability",
    category: "Voice Cloning Training",
    question: "How much availability would you estimate is needed over the coming days, between August 11th and 31st?",
    answer:
      "Estimate an average of 6-8 hours to create a voice. Note this will depend on the content, style of the exercise/trainer, and individual speed and expertise.",
    tags: ["availability", "schedule"],
  },
  {
    id: "faq_voice_training_guidelines_pay",
    category: "Voice Cloning Training",
    question: "Will the project guidelines and glossaries be provided in advance, or would that also fall under the QC's responsibilities? If so, would those additional tasks be paid per hour?",
    answer: "The glossary is provided by the client and will be available within the task application.",
    tags: ["guidelines", "glossary", "qc"],
  },
  {
    id: "faq_voice_training_qc_expectations",
    category: "Voice Cloning Training",
    question: "What are the quality expectations for the QC role -- is the focus primarily on term consistency, or on ensuring the final result sounds human-like?",
    answer: "The QC task has to be thorough to ensure consistency, as well as make sure the audio captures the content appropriately.",
    tags: ["qc", "quality"],
  },
  {
    id: "faq_voice_training_qc_turnaround",
    category: "Voice Cloning Training",
    question: "Once a dubber submits their work, how much time will the QC have to complete the review?",
    answer: "The timeline is about 20 or more minutes of QC in a day. You'll have a day to perform the QC.",
    tags: ["qc", "turnaround"],
  },
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

  for (const f of FAQ_ENTRIES) {
    await prisma.faqEntry.upsert({
      where: { id: f.id },
      update: { category: f.category, question: f.question, answer: f.answer, tags: f.tags },
      create: f,
    });
    console.log(`Seeded FAQ: ${f.id}`);
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
