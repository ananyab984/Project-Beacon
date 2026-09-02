import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@server/config", () => ({
  config: {
    clayWebhookPathToken: "path-token",
    clayWebhookSecret: "clay-secret",
  },
}));

vi.mock("@server-root/prisma", () => ({
  prisma: {
    lead: { findFirst: vi.fn(), update: vi.fn() },
    emailQueueItem: { updateMany: vi.fn() },
    conversation: { updateMany: vi.fn() },
  },
}));

import { prisma } from "@server-root/prisma";
import { ClayService } from "@server/services/clay.service";

const p: any = prisma;
const validToken = "path-token";
const validSecret = "clay-secret";

const baseLead = {
  id: "lead-1",
  profileLink: "https://linkedin.com/in/jane-doe",
  email: null,
  contactNumber: null,
  fieldSources: {},
  flags: [],
  clayData: null,
  services: ["Subtitling"],
  targetLanguage: "German",
};

beforeEach(() => {
  vi.clearAllMocks();
  p.lead.findFirst.mockResolvedValue({ ...baseLead });
  p.lead.update.mockResolvedValue({});
  p.emailQueueItem.updateMany.mockResolvedValue({});
  p.conversation.updateMany.mockResolvedValue({});
});

describe("ClayService.handleWebhookEvent", () => {
  it("throws 401 for an invalid path token", async () => {
    await expect(ClayService.handleWebhookEvent("wrong", validSecret, {})).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 401 for an invalid secret header", async () => {
    await expect(ClayService.handleWebhookEvent(validToken, "wrong", {})).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 400 when source_row_index or linkedin_enrichment is missing", async () => {
    await expect(ClayService.handleWebhookEvent(validToken, validSecret, { source_row_index: "x" })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      ClayService.handleWebhookEvent(validToken, validSecret, { linkedin_enrichment: {} })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns no_matching_lead when no lead's profileLink matches the correlation id", async () => {
    p.lead.findFirst.mockResolvedValue(null);
    const result = await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: "https://linkedin.com/in/unknown",
      linkedin_enrichment: { headline: "x" },
    });
    expect(result).toEqual({ status: "no_matching_lead", correlationId: "https://linkedin.com/in/unknown" });
    expect(p.lead.update).not.toHaveBeenCalled();
  });

  it("maps Clay's raw fields onto the canonical Lead columns", async () => {
    await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: {
        summary: "About me",
        headline: "Senior Translator",
        title: "Freelance Translator",
        certifications: ["ATA Certified", { name: "Cert B" }],
        country: "Germany",
        name: "Jane Doe",
      },
    });

    const data = p.lead.update.mock.calls[0][0].data;
    expect(data.aboutSnippet).toBe("About me");
    expect(data.headline).toBe("Senior Translator");
    expect(data.currentTitle).toBe("Freelance Translator");
    expect(data.certifications).toEqual(["ATA Certified", "Cert B"]);
    expect(data.country).toBe("Germany");
    expect(data.displayName).toBe("Jane Doe");
  });

  it("fills a validated email from contact_details only when the lead doesn't already have one", async () => {
    await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: { headline: "x" },
      contact_details: "jane@example.com",
    });
    expect(p.lead.update.mock.calls[0][0].data.email).toBe("jane@example.com");
  });

  it("never overwrites an existing email even if contact_details carries a different one", async () => {
    p.lead.findFirst.mockResolvedValue({ ...baseLead, email: "existing@example.com" });
    await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: { headline: "x" },
      contact_details: "new@example.com",
    });
    expect(p.lead.update.mock.calls[0][0].data).not.toHaveProperty("email");
  });

  it("ignores a malformed contact_details value that isn't a valid email", async () => {
    await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: { headline: "x" },
      contact_details: "not-an-email",
    });
    expect(p.lead.update.mock.calls[0][0].data).not.toHaveProperty("email");
  });

  it("marks the lead COMPLETE and clears the Clay dispatch marker even when Clay returns genuinely nothing usable", async () => {
    const result = await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: {},
    });

    expect(result).toEqual({ status: "empty_enrichment", leadId: "lead-1" });
    const data = p.lead.update.mock.calls[0][0].data;
    expect(data.enrichmentStatus).toBe("COMPLETE");
    expect(data.fieldSources._clay_dispatch).toBe("complete");
    expect(data.flags).toContain("ON_HOLD");
  });

  it("does not add ON_HOLD on an empty enrichment if the lead already has contact info", async () => {
    p.lead.findFirst.mockResolvedValue({ ...baseLead, email: "jane@example.com" });
    await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: {},
    });
    expect(p.lead.update.mock.calls[0][0].data.flags).not.toContain("ON_HOLD");
  });

  it("applies ON_HOLD when Clay returns usable data but still no contact info", async () => {
    const result = await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: { headline: "Senior Translator" },
    });
    expect(result.status).toBe("applied");
    expect(p.lead.update.mock.calls[0][0].data.flags).toContain("ON_HOLD");
    expect(p.lead.update.mock.calls[0][0].data.enrichmentStatus).toBe("COMPLETE");
  });

  it("does not apply ON_HOLD when the enrichment itself supplies contact info", async () => {
    const result = await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: { headline: "x" },
      contact_details: "jane@example.com",
    });
    expect(result.status).toBe("applied");
    expect(p.lead.update.mock.calls[0][0].data.flags).not.toContain("ON_HOLD");
  });

  it("drops any pre-existing ON_HOLD flag once the lead is resolved as reachable", async () => {
    p.lead.findFirst.mockResolvedValue({ ...baseLead, flags: ["ON_HOLD", "DNC"], email: "jane@example.com" });
    await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: { headline: "x" },
    });
    const flags = p.lead.update.mock.calls[0][0].data.flags;
    expect(flags).toEqual(["DNC"]);
  });

  it("merges the new raw Clay payload onto any prior clayData rather than replacing it", async () => {
    p.lead.findFirst.mockResolvedValue({ ...baseLead, clayData: { connections: 500 } });
    await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: { headline: "x" },
    });
    expect(p.lead.update.mock.calls[0][0].data.clayData).toEqual({ connections: 500, headline: "x" });
  });

  it("stamps fieldSources with 'clay' for every mapped key and preserves prior sources", async () => {
    p.lead.findFirst.mockResolvedValue({ ...baseLead, fieldSources: { country: "manual" } });
    await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: { headline: "x", country: "France" },
    });
    const fs = p.lead.update.mock.calls[0][0].data.fieldSources;
    expect(fs.headline).toBe("clay");
    expect(fs.country).toBe("clay");
    expect(fs._clay_dispatch).toBe("complete");
  });

  it("syncs candidateRole onto queued drafts and conversations for this lead", async () => {
    await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: { headline: "x" },
    });
    expect(p.emailQueueItem.updateMany).toHaveBeenCalledWith({
      where: { leadId: "lead-1" },
      data: { candidateRole: "Subtitling" },
    });
    expect(p.conversation.updateMany).toHaveBeenCalledWith({
      where: { leadId: "lead-1" },
      data: { candidateRole: "Subtitling" },
    });
  });

  it("does not let a failure syncing candidateRole break the webhook response", async () => {
    p.emailQueueItem.updateMany.mockRejectedValue(new Error("db hiccup"));
    const result = await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: { headline: "x" },
    });
    expect(result.status).toBe("applied");
  });

  it("returns the applied status with the list of fields that were updated", async () => {
    const result = await ClayService.handleWebhookEvent(validToken, validSecret, {
      source_row_index: baseLead.profileLink,
      linkedin_enrichment: { headline: "Senior Translator", title: "Freelance Translator" },
    });
    expect(result).toMatchObject({ status: "applied", leadId: "lead-1" });
    expect(result.fieldsUpdated.sort()).toEqual(["currentTitle", "headline"]);
  });
});
