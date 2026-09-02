import { describe, it, expect } from "vitest";
import { buildDraftLeadPayload } from "@server/lib/draftLeadPayload";

function makeLead(overrides: Record<string, any> = {}): any {
  return {
    firstName: "Jane",
    fullName: "Jane Doe",
    country: "Germany",
    source: "LINKEDIN",
    profileLink: "https://linkedin.com/in/jane-doe",
    email: "jane@example.com",
    services: ["Subtitling"],
    sourceLanguage: "English",
    targetLanguage: "German",
    secondaryLanguages: ["French"],
    yearsOfExperience: { toNumber: () => 5 },
    vendorExperience: "Netflix",
    enrichmentStatus: "COMPLETE",
    headline: "Senior Subtitler",
    aboutSnippet: "About me",
    currentTitle: "Freelancer",
    toolsSoftware: ["Aegisub"],
    certifications: ["Cert A"],
    clayData: null,
    rawScrapeData: null,
    ...overrides,
  };
}

describe("buildDraftLeadPayload", () => {
  it("maps every basic field onto the drafting payload shape", () => {
    const payload = buildDraftLeadPayload(makeLead());
    expect(payload.First_Name).toBe("Jane");
    expect(payload.Full_Name).toBe("Jane Doe");
    expect(payload.Email_Address).toBe("jane@example.com");
    expect(payload.Services).toBe("Subtitling");
    expect(payload.Secondary_Languages).toBe("French");
    expect(payload.Years_of_Exp).toBe(5);
    expect(payload.Tools_Software).toBe("Aegisub");
    expect(payload.Certifications).toBe("Cert A");
  });

  it("uses emailOverride instead of the lead's own email when provided", () => {
    const payload = buildDraftLeadPayload(makeLead(), "manual@example.com");
    expect(payload.Email_Address).toBe("manual@example.com");
  });

  it("returns null Years_of_Exp when yearsOfExperience is null", () => {
    const payload = buildDraftLeadPayload(makeLead({ yearsOfExperience: null }));
    expect(payload.Years_of_Exp).toBeNull();
  });

  it("leaves every Clay_* field undefined when clayData is null", () => {
    const payload = buildDraftLeadPayload(makeLead({ clayData: null }));
    expect(payload.Clay_Experience).toBeUndefined();
    expect(payload.Clay_Full_Data).toBeUndefined();
  });

  it("extracts Clay fields via the first-present-key fallback chain", () => {
    const payload = buildDraftLeadPayload(
      makeLead({ clayData: { pastRoles: ["Role A"], currentRoles: ["Role B"], education: ["School"] } })
    );
    // "experience" isn't present, so it falls back to "pastRoles"
    expect(payload.Clay_Experience).toEqual(["Role A"]);
    expect(payload.Clay_Current_Experience).toEqual(["Role B"]);
    expect(payload.Clay_Education).toEqual(["School"]);
  });

  it("prefers the primary key over its fallback when both are present", () => {
    const payload = buildDraftLeadPayload(
      makeLead({ clayData: { experience: ["Primary"], pastRoles: ["Fallback"] } })
    );
    expect(payload.Clay_Experience).toEqual(["Primary"]);
  });

  it("includes the full raw Clay payload verbatim alongside the curated views", () => {
    const rawClay = { experience: ["X"], connections: 500, jobs_count: 3 };
    const payload = buildDraftLeadPayload(makeLead({ clayData: rawClay }));
    expect(payload.Clay_Full_Data).toEqual(rawClay);
  });

  it("passes through rawScrapeData when present, undefined when null", () => {
    expect(buildDraftLeadPayload(makeLead({ rawScrapeData: { foo: "bar" } })).Raw_Scrape_Data).toEqual({ foo: "bar" });
    expect(buildDraftLeadPayload(makeLead({ rawScrapeData: null })).Raw_Scrape_Data).toBeUndefined();
  });
});
