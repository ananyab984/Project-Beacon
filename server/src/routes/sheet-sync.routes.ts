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
  contactName?: string;
  contactEmail?: string;
  deadline?: string;
  notes?: string;
}

export function parseDemandsFromCsv(csvText: string, sheetId: string = "sheet"): ParsedSheetDemand[] {
  const rows = parseCsvRows(csvText);
  if (rows.length <= 1) return [];

  const rawHeaders = rows[0];
  const normHeaders = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));

  const findIdx = (keywords: string[]) => normHeaders.findIndex((h) => keywords.some((k) => h.includes(k)));

  // Client Details
  const clientIdx = findIdx(["clientname", "client", "company", "customer", "account"]);
  const projectIdx = findIdx(["projectname", "project", "campaign", "program"]);
  const requestedByIdx = findIdx(["requestedby", "pm", "contactname", "contact"]);
  const emailIdx = findIdx(["emailaddress", "email", "mail"]);
  const priorityIdx = findIdx(["prioritylevel", "priority", "urgency"]);
  const targetDateIdx = findIdx(["targetdate", "headcountonboarded", "deadline", "duedate"]);
  const goLiveDateIdx = findIdx(["projectgolivedate", "golivedate", "golive"]);
  const contentTypeIdx = findIdx(["contenttype", "content"]);

  // Block 1 Columns
  const lang1Idx = findIdx(["targetlanguage", "targetlang", "language", "lang"]);
  const service1Idx = findIdx(["servicetype", "service", "services"]);
  const headcount1Idx = findIdx(["numberofresourcesneeded", "resourcesneeded", "headcount", "needed", "qty", "seats"]);
  const epLength1Idx = findIdx(["episodefilelength", "filelength", "lengthmin"]);
  const numEp1Idx = findIdx(["numberofepisodes", "episodesfiles", "episodes"]);
  const notes1Idx = findIdx(["anyadditionalinformation", "additionalinfo", "notes", "note", "description"]);

  // Block 2 Columns (Suffix '2')
  const lang2Idx = normHeaders.findIndex((h) => h.includes("targetlanguage2") || h.includes("targetlang2") || h.includes("language2"));
  const service2Idx = normHeaders.findIndex((h) => h.includes("servicetype2") || h.includes("service2"));
  const headcount2Idx = normHeaders.findIndex((h) => h.includes("numberofresourcesneeded2") || h.includes("resourcesneeded2") || h.includes("headcount2"));
  const epLength2Idx = normHeaders.findIndex((h) => h.includes("episodefilelengthmin2") || h.includes("filelength2"));
  const numEp2Idx = normHeaders.findIndex((h) => h.includes("numberofepisodesfiles2") || h.includes("episodes2"));

  // Block 3 Columns (Suffix '3')
  const lang3Idx = normHeaders.findIndex((h) => h.includes("targetlanguage3") || h.includes("targetlang3") || h.includes("language3"));
  const service3Idx = normHeaders.findIndex((h) => h.includes("servicetype3") || h.includes("service3"));
  const headcount3Idx = normHeaders.findIndex((h) => h.includes("numberofresourcesneeded3") || h.includes("resourcesneeded3") || h.includes("headcount3"));

  const results: ParsedSheetDemand[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 2) continue;

    const clientName = (clientIdx >= 0 && row[clientIdx] ? row[clientIdx].trim() : "") || "Sample Client";
    const projectName = projectIdx >= 0 && row[projectIdx] ? row[projectIdx].trim() : undefined;
    const contactName = requestedByIdx >= 0 && row[requestedByIdx] ? row[requestedByIdx].trim() : undefined;
    const contactEmail = emailIdx >= 0 && row[emailIdx] ? row[emailIdx].trim() : undefined;
    const deadline = targetDateIdx >= 0 && row[targetDateIdx] ? row[targetDateIdx].trim() : undefined;
    const goLive = goLiveDateIdx >= 0 && row[goLiveDateIdx] ? row[goLiveDateIdx].trim() : undefined;
    const contentType = contentTypeIdx >= 0 && row[contentTypeIdx] ? row[contentTypeIdx].trim() : undefined;

    const rawPriority = (priorityIdx >= 0 && row[priorityIdx] ? row[priorityIdx] : "").toLowerCase();
    const priority: "STANDARD" | "HIGH" | "CRITICAL" =
      rawPriority.includes("urgent") || rawPriority.includes("<15") || rawPriority.includes("crit") || rawPriority.includes("p0")
        ? "CRITICAL"
        : rawPriority.includes("high") || rawPriority.includes("15") || rawPriority.includes("p1")
        ? "HIGH"
        : "STANDARD";

    // Helper to process a language block
    const processBlock = (
      blockNum: number,
      langIdxCol: number,
      servIdxCol: number,
      hcIdxCol: number,
      epLenIdxCol?: number,
      numEpIdxCol?: number,
      notesIdxCol?: number
    ) => {
      const rawLang = langIdxCol >= 0 && row[langIdxCol] ? row[langIdxCol].trim() : "";
      if (!rawLang) return;

      const rawService = servIdxCol >= 0 && row[servIdxCol] ? row[servIdxCol].trim() : "Subtitling";
      const rawHeadcount = hcIdxCol >= 0 && row[hcIdxCol] ? parseInt(row[hcIdxCol], 10) : 1;
      const headcountNeeded = isNaN(rawHeadcount) || rawHeadcount < 1 ? 1 : rawHeadcount;

      const epLen = epLenIdxCol !== undefined && epLenIdxCol >= 0 && row[epLenIdxCol] ? row[epLenIdxCol].trim() : undefined;
      const numEp = numEpIdxCol !== undefined && numEpIdxCol >= 0 && row[numEpIdxCol] ? row[numEpIdxCol].trim() : undefined;
      const rawNotes = notesIdxCol !== undefined && notesIdxCol >= 0 && row[notesIdxCol] ? row[notesIdxCol].trim() : undefined;

      const noteParts: string[] = [];
      if (contentType) noteParts.push(`Content Type: ${contentType}`);
      if (goLive) noteParts.push(`Go-Live Date: ${goLive}`);
      if (epLen) noteParts.push(`Length: ${epLen} min`);
      if (numEp) noteParts.push(`Episodes/Files: ${numEp}`);
      if (rawNotes) noteParts.push(`Notes: ${rawNotes}`);
      const notes = noteParts.join(" | ") || undefined;

      // Handle comma-separated languages (e.g. "Gujarati, Marathi")
      const targetLanguages = rawLang.split(/[,;/]+/).map((l) => l.trim()).filter(Boolean);
      // Handle comma-separated services (e.g. "Dubbing, CC")
      const serviceTypes = rawService.split(/[,;/]+/).map((s) => s.trim()).filter(Boolean);

      for (const singleLang of targetLanguages.length > 0 ? targetLanguages : [rawLang]) {
        for (const singleService of serviceTypes.length > 0 ? serviceTypes : [rawService]) {
          const cleanClient = clientName.toLowerCase().replace(/[^a-z0-9]/g, "_");
          const cleanLang = singleLang.toLowerCase().replace(/[^a-z0-9]/g, "_");
          const cleanService = singleService.toLowerCase().replace(/[^a-z0-9]/g, "_");
          const sheetRowId = `sheet_${sheetId}_row_${i}_b${blockNum}_${cleanClient}_${cleanLang}_${cleanService}`;

          results.push({
            sheetRowId,
            clientName,
            language: singleLang,
            service: singleService,
            headcountNeeded,
            priority,
            projectName,
            contactName,
            contactEmail,
            deadline,
            notes,
          });
        }
      }
    };

    // Process Block 1
    processBlock(1, lang1Idx, service1Idx, headcount1Idx, epLength1Idx, numEp1Idx, notes1Idx);

    // Process Block 2 (if present)
    if (lang2Idx >= 0) {
      processBlock(2, lang2Idx, service2Idx, headcount2Idx, epLength2Idx, numEp2Idx);
    }

    // Process Block 3 (if present)
    if (lang3Idx >= 0) {
      processBlock(3, lang3Idx, service3Idx, headcount3Idx);
    }
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
