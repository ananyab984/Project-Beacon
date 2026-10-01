import { prisma } from "../prisma";

/**
 * Org-level integration settings (Slack bot token, the notification system's
 * Unipile account id) live in SystemConfig, editable by the owner in-app,
 * instead of only as env vars only engineering can change. DB value wins
 * when set; falls back to the matching env var so a deploy can still seed a
 * default without the owner having configured anything yet.
 */
export async function getSystemSetting(key: string): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  if (row?.value) return row.value;
  return process.env[key] || null;
}

export async function setSystemSetting(key: string, value: string | null, notes?: string): Promise<void> {
  if (!value) {
    await prisma.systemConfig.deleteMany({ where: { key } });
    return;
  }
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value, notes },
    update: { value, notes },
  });
}
