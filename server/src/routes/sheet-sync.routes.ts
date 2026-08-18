import { Router, Request, Response } from "express";
import { z } from "zod";
import axios from "axios";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";

export const sheetSyncRouter = Router();

sheetSyncRouter.use(authenticateJwt);

const putSheetSyncSchema = z.object({
  sheetUrl: z.string().url(),
});

/** Convert Google Sheets URL to a direct CSV export link */
export function convertGoogleSheetUrlToCsv(url: string): { csvUrl: string; sheetId: string | null } {
  if (!url) return { csvUrl: "", sheetId: null };
  const trimmed = url.trim();
  if (trimmed.includes("/pub?output=csv") || trimmed.endsWith(".csv")) {
    return { csvUrl: trimmed, sheetId: "published" };
  }
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) {
    const sheetId = match[1];
    const gidMatch = trimmed.match(/gid=([0-9]+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : "";
    return {
      csvUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`,
      sheetId,
    };
  }
  return { csvUrl: trimmed, sheetId: null };
}

/** Parse CSV text into tokens supporting double-quoted fields with embedded commas */
export function parseCsvRows(csvText: string): string[][] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const rows: string[][] = [];
  for (const line of lines) {
    const fields: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === "," && !inQuotes) {
        fields.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    fields.push(cur.trim());
    rows.push(fields);
  }
  return rows;
}

export interface ParsedSheetDemand {
  sheetRowId: string;
  clientName: string;
  language: string;
  service: string;
  headcountNeeded: number;
  priority: "STANDARD" | "HIGH" | "CRITICAL";
  projectName?: string;
  notes?: string;
}

export function parseDemandsFromCsv(csvText: string, sheetId: string = "sheet"): ParsedSheetDemand[] {
  const rows = parseCsvRows(csvText);
  if (rows.length <= 1) return [];

  const headers = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const findIdx = (keywords: string[]) => headers.findIndex((h) => keywords.some((k) => h.includes(k)));

  const clientIdx = findIdx(["client", "company", "customer", "account"]);
  const langIdx = findIdx(["language", "lang", "target", "source", "pair"]);
  const serviceIdx = findIdx(["service", "role", "job", "type", "domain"]);
  const headcountIdx = findIdx(["headcount", "needed", "required", "seats", "count", "qty", "quantity"]);
  const priorityIdx = findIdx(["priority", "urgency", "level"]);
  const projectIdx = findIdx(["project", "campaign", "program"]);
  const notesIdx = findIdx(["note", "notes", "description", "details"]);

  const results: ParsedSheetDemand[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 2) continue;

    const rawClient = (clientIdx >= 0 && row[clientIdx] ? row[clientIdx] : "").trim();
    const rawLang = (langIdx >= 0 && row[langIdx] ? row[langIdx] : "").trim();
    const rawService = (serviceIdx >= 0 && row[serviceIdx] ? row[serviceIdx] : "").trim() || "Translation";

    if (!rawClient && !rawLang) continue;

    const clientName = rawClient || "General Client";
    const language = rawLang || "English";
    const rawNeeded = headcountIdx >= 0 && row[headcountIdx] ? parseInt(row[headcountIdx], 10) : 1;
    const headcountNeeded = isNaN(rawNeeded) || rawNeeded < 1 ? 1 : rawNeeded;

    const rawPriority = (priorityIdx >= 0 && row[priorityIdx] ? row[priorityIdx] : "").toLowerCase();
    const priority: "STANDARD" | "HIGH" | "CRITICAL" = rawPriority.includes("crit") || rawPriority.includes("p0")
      ? "CRITICAL"
      : rawPriority.includes("high") || rawPriority.includes("p1")
      ? "HIGH"
      : "STANDARD";

    const projectName = projectIdx >= 0 && row[projectIdx] ? row[projectIdx].trim() : undefined;
    const notes = notesIdx >= 0 && row[notesIdx] ? row[notesIdx].trim() : undefined;

    const cleanClient = clientName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const cleanLang = language.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const cleanService = rawService.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const sheetRowId = `sheet_${sheetId}_row_${i}_${cleanClient}_${cleanLang}_${cleanService}`;

    results.push({
      sheetRowId,
      clientName,
      language,
      service: rawService,
      headcountNeeded,
      priority,
      projectName,
      notes,
    });
  }

  return results;
}

// GET /api/sheet-sync — current user's Google Sheet sync config
sheetSyncRouter.get(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const config = await prisma.sheetSyncConfig.findUnique({
      where: { ownerUserId: req.user!.id },
    });
    return res.json(config ?? { sheetUrl: null, lastSyncedAt: null });
  })
);

// PUT /api/sheet-sync — upsert the sheet URL for the current user
sheetSyncRouter.put(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const { sheetUrl } = putSheetSyncSchema.parse(req.body);

    const config = await prisma.sheetSyncConfig.upsert({
      where: { ownerUserId: req.user!.id },
      update: { sheetUrl },
      create: { ownerUserId: req.user!.id, sheetUrl },
    });
    return res.json(config);
  })
);

// POST /api/sheet-sync/sync — execute real-time ingestion from configured Google Sheet
sheetSyncRouter.post(
  "/sync",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const config = await prisma.sheetSyncConfig.findUnique({
      where: { ownerUserId: req.user!.id },
    });

    const sheetUrl = req.body?.sheetUrl || config?.sheetUrl;
    if (!sheetUrl) {
      throw new ApiError(400, "NO_SHEET_URL", "No Google Sheet URL is configured. Please provide a sheet URL.");
    }

    const { csvUrl, sheetId } = convertGoogleSheetUrlToCsv(sheetUrl);
    if (!csvUrl) {
      throw new ApiError(400, "INVALID_SHEET_URL", "Could not convert Google Sheet URL to CSV export format.");
    }

    let csvData: string;
    try {
      const response = await axios.get(csvUrl, {
        timeout: 15000,
        headers: { Accept: "text/csv, text/plain, */*" },
        maxRedirects: 5,
      });
      csvData = String(response.data);

      if (typeof csvData === "string" && (csvData.includes("<!DOCTYPE html") || csvData.includes("<html"))) {
        throw new Error("Google Sheet returned an HTML sign-in page. Please make the sheet public with 'Anyone with the link can view'.");
      }
    } catch (err: any) {
      console.error("[sheet-sync] Fetch failed:", err?.message || err);
      return res.status(400).json({
        synced: false,
        reason: err?.message || "Failed to fetch CSV from Google Sheet. Ensure the sheet is accessible.",
      });
    }

    const parsedRows = parseDemandsFromCsv(csvData, sheetId || "synced");
    if (parsedRows.length === 0) {
      return res.status(200).json({
        synced: true,
        added: 0,
        updated: 0,
        totalRows: 0,
        message: "Sheet was fetched successfully, but no valid client demand data rows were found.",
      });
    }

    let added = 0;
    let updated = 0;

    for (const row of parsedRows) {
      await prisma.$transaction(async (tx) => {
        // 1. Find or create client
        let client = await tx.client.findFirst({
          where: { name: { equals: row.clientName, mode: "insensitive" } },
        });
        if (!client) {
          client = await tx.client.create({
            data: { name: row.clientName, notes: "Created via Google Sheet Sync" },
          });
        }

        // 2. Check existing ClientDemand by sheetRowId or (clientId + language)
        let existingDemand = await tx.clientDemand.findUnique({
          where: { sheetRowId: row.sheetRowId },
          include: { serviceBreakdown: true },
        });

        if (!existingDemand) {
          existingDemand = await tx.clientDemand.findFirst({
            where: {
              clientId: client.id,
              language: { equals: row.language, mode: "insensitive" },
            },
            include: { serviceBreakdown: true },
          });
        }

        if (existingDemand) {
          // Update existing demand
          const currentFilled = existingDemand.filled;
          const newHeadcount = row.headcountNeeded;
          const newGap = Math.max(0, newHeadcount - currentFilled);

          await tx.clientDemand.update({
            where: { id: existingDemand.id },
            data: {
              sheetRowId: row.sheetRowId,
              headcountNeeded: newHeadcount,
              gap: newGap,
              priority: row.priority,
              projectName: row.projectName ?? existingDemand.projectName,
              notes: row.notes ?? existingDemand.notes,
            },
          });

          // Upsert service breakdown
          await tx.clientDemandService.upsert({
            where: {
              clientDemandId_service: {
                clientDemandId: existingDemand.id,
                service: row.service,
              },
            },
            update: { needed: newHeadcount, gap: newGap },
            create: {
              clientDemandId: existingDemand.id,
              service: row.service,
              needed: newHeadcount,
              filled: 0,
              gap: newHeadcount,
            },
          });

          // Update requirement if exists
          const existingReq = await tx.requirement.findFirst({
            where: {
              clientId: client.id,
              language: { equals: row.language, mode: "insensitive" },
              service: { equals: row.service, mode: "insensitive" },
            },
          });
          if (existingReq) {
            const reqFilled = existingReq.filled;
            const reqGap = Math.max(0, newHeadcount - reqFilled);
            await tx.requirement.update({
              where: { id: existingReq.id },
              data: {
                headcountNeeded: newHeadcount,
                gap: reqGap,
                priority: row.priority,
                projectName: row.projectName ?? existingReq.projectName,
                notes: row.notes ?? existingReq.notes,
              },
            });
          }

          updated++;
        } else {
          // Create new ClientDemand + ServiceBreakdown + Requirement
          const newDemand = await tx.clientDemand.create({
            data: {
              clientId: client.id,
              language: row.language,
              headcountNeeded: row.headcountNeeded,
              filled: 0,
              gap: row.headcountNeeded,
              priority: row.priority,
              projectName: row.projectName,
              notes: row.notes,
              sheetRowId: row.sheetRowId,
              serviceBreakdown: {
                create: [
                  {
                    service: row.service,
                    needed: row.headcountNeeded,
                    filled: 0,
                    gap: row.headcountNeeded,
                  },
                ],
              },
            },
          });

          await tx.requirement.create({
            data: {
              clientId: client.id,
              title: `${row.clientName} — ${row.language} ${row.service}`,
              language: row.language,
              service: row.service,
              headcountNeeded: row.headcountNeeded,
              gap: row.headcountNeeded,
              priority: row.priority,
              status: "UNASSIGNED",
              projectName: row.projectName,
              notes: row.notes,
            },
          });

          added++;
        }
      });
    }

    const now = new Date();
    await prisma.sheetSyncConfig.upsert({
      where: { ownerUserId: req.user!.id },
      update: { sheetUrl, lastSyncedAt: now },
      create: { ownerUserId: req.user!.id, sheetUrl, lastSyncedAt: now },
    });

    return res.json({
      synced: true,
      added,
      updated,
      totalRows: parsedRows.length,
      lastSyncedAt: now.toISOString(),
    });
  })
);
