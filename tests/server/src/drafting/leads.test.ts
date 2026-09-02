import { describe, it, expect } from "vitest";
import { Lead, checkChannelEligibility, fromRecord } from "@server/drafting/leads";

describe("Lead — computed getters", () => {
  it("primaryLanguage prefers targetLanguage, falls back to sourceLanguage, then a generic label", () => {
    expect(new Lead({ firstName: "A", targetLanguage: "German", sourceLanguage: "English" }).primaryLanguage).toBe("German");
    expect(new Lead({ firstName: "A", sourceLanguage: "English" }).primaryLanguage).toBe("English");
    expect(new Lead({ firstName: "A" }).primaryLanguage).toBe("language");
  });

  it("hasEmail requires an '@' in the address", () => {
    expect(new Lead({ firstName: "A", email: "a@b.com" }).hasEmail).toBe(true);
    expect(new Lead({ firstName: "A", email: "not-an-email" }).hasEmail).toBe(false);
    expect(new Lead({ firstName: "A", email: null }).hasEmail).toBe(false);
  });

  it("hasLinkedin requires a genuine linkedin.com/in/ or /pub/ URL", () => {
    expect(new Lead({ firstName: "A", profileLink: "https://linkedin.com/in/jane" }).hasLinkedin).toBe(true);
    expect(new Lead({ firstName: "A", profileLink: "https://LINKEDIN.com/pub/jane" }).hasLinkedin).toBe(true);
    expect(new Lead({ firstName: "A", profileLink: "https://proz.com/profile/jane" }).hasLinkedin).toBe(false);
    expect(new Lead({ firstName: "A", profileLink: null }).hasLinkedin).toBe(false);
  });

  describe("isEnriched", () => {
    it("trusts an explicit terminal-negative enrichmentStatus even with other data present", () => {
      expect(new Lead({ firstName: "A", enrichmentStatus: "failed", email: "a@b.com" }).isEnriched).toBe(false);
      expect(new Lead({ firstName: "A", enrichmentStatus: "PENDING", email: "a@b.com" }).isEnriched).toBe(false);
    });

    it("trusts an explicit terminal-positive enrichmentStatus", () => {
      expect(new Lead({ firstName: "A", enrichmentStatus: "complete" }).isEnriched).toBe(true);
      expect(new Lead({ firstName: "A", enrichmentStatus: "ENRICHMENT_COMPLETE" }).isEnriched).toBe(true);
    });

    it("falls back to a real-name + has-details heuristic when status is unset/unrecognized", () => {
      expect(new Lead({ firstName: "Jane", email: "a@b.com" }).isEnriched).toBe(true);
      expect(new Lead({ firstName: "there" }).isEnriched).toBe(false); // placeholder name
      expect(new Lead({ firstName: "Jane" }).isEnriched).toBe(false); // real name but zero details
    });
  });

  describe("groundingFacts", () => {
    it("always includes first_name and only includes other fields that are actually present", () => {
      const facts = new Lead({ firstName: "Jane" }).groundingFacts();
      expect(facts.first_name).toBe("Jane");
      expect(facts).not.toHaveProperty("country");
      expect(facts).not.toHaveProperty("services");
    });

    it("only claims services as a fact when corroborated by the lead's own scraped signals", () => {
      const uncorroborated = new Lead({ firstName: "Jane", services: ["Voice Over"], currentTitle: "Subtitler" });
      expect(uncorroborated.groundingFacts()).not.toHaveProperty("services");

      const corroborated = new Lead({ firstName: "Jane", services: ["Subtitling"], currentTitle: "Subtitling Specialist" });
      expect(corroborated.groundingFacts().services).toBe("Subtitling");
    });

    it("claims services when there's no scraped signal to check against at all (fails open)", () => {
      const thin = new Lead({ firstName: "Jane", services: ["Voice Over"] });
      expect(thin.groundingFacts().services).toBe("Voice Over");
    });

    it("excludes experience entries at Global3 itself from recent_experience", () => {
      const lead = new Lead({
        firstName: "Jane",
        experience: [
          { title: "Contractor", company: "Global3", start_date: "2024" },
          { title: "Subtitler", company: "Acme Studios", start_date: "2020", end_date: "2023" },
        ],
      });
      const facts = lead.groundingFacts();
      expect(facts.recent_experience).toContain("Acme Studios");
      expect(facts.recent_experience).not.toContain("Global3");
    });

    it("takes only the first education entry, skipping 'Not specified' fields", () => {
      const lead = new Lead({
        firstName: "Jane",
        education: [{ degree: "Not specified", field_of_study: "Linguistics", school_name: "University X" }],
      });
      expect(lead.groundingFacts().education).toBe("Linguistics, University X");
    });

    it("caps additional_languages_spoken at 5 and courses_completed at 3", () => {
      const lead = new Lead({
        firstName: "Jane",
        languages: ["A", "B", "C", "D", "E", "F", "G"],
        courses: ["C1", "C2", "C3", "C4"],
      });
      const facts = lead.groundingFacts();
      expect(facts.additional_languages_spoken.split(", ")).toHaveLength(5);
      expect(facts.courses_completed.split(", ")).toHaveLength(3);
    });
  });
});

describe("checkChannelEligibility", () => {
  it("manualOverride always wins regardless of contact data", () => {
    const lead = new Lead({ firstName: "Jane" }); // no email, no linkedin
    const result = checkChannelEligibility(lead, "email", true);
    expect(result).toEqual({ channel: "email", eligible: true, reason: "MANUAL_OVERRIDE", manualOverride: true });
  });

  it("email channel requires hasEmail", () => {
    expect(checkChannelEligibility(new Lead({ firstName: "A", email: "a@b.com" }), "email").eligible).toBe(true);
    const noEmail = checkChannelEligibility(new Lead({ firstName: "A" }), "email");
    expect(noEmail.eligible).toBe(false);
    expect(noEmail.reason).toBe("NO_EMAIL");
  });

  it("linkedin channel requires hasLinkedin", () => {
    expect(
      checkChannelEligibility(new Lead({ firstName: "A", profileLink: "https://linkedin.com/in/a" }), "linkedin").eligible
    ).toBe(true);
    const noLinkedin = checkChannelEligibility(new Lead({ firstName: "A" }), "linkedin");
    expect(noLinkedin.eligible).toBe(false);
    expect(noLinkedin.reason).toBe("NO_LINKEDIN_PROFILE");
  });

  it("an unknown channel is never eligible, with a descriptive reason", () => {
    const result = checkChannelEligibility(new Lead({ firstName: "A" }), "whatsapp");
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("UNKNOWN_CHANNEL:whatsapp");
  });
});

describe("fromRecord", () => {
  it("normalizes PascalCase field names into a Lead", () => {
    const lead = fromRecord({
      First_Name: "Jane",
      Full_Name: "Jane Doe",
      Email_Address: "jane@example.com",
      Services: "Subtitling, Dubbing",
      Years_of_Exp: "5",
    });
    expect(lead.firstName).toBe("Jane");
    expect(lead.email).toBe("jane@example.com");
    expect(lead.services).toEqual(["Subtitling", "Dubbing"]);
    expect(lead.yearsOfExp).toBe(5);
  });

  it("treats known placeholder sentinels ('[Missing Input]', 'N/A', etc.) as null, not literal values", () => {
    const lead = fromRecord({ First_Name: "Jane", Country_of_Residence: "[Missing Input]", Vendor_Experience: "N/A" });
    expect(lead.country).toBeNull();
    expect(lead.vendorExperience).toBeNull();
  });

  it("falls back to lowercase field names when PascalCase is absent", () => {
    const lead = fromRecord({ first_name: "Jane", email: "jane@example.com" });
    expect(lead.firstName).toBe("Jane");
    expect(lead.email).toBe("jane@example.com");
  });

  it("defaults firstName to 'there' when genuinely missing", () => {
    const lead = fromRecord({});
    expect(lead.firstName).toBe("there");
  });

  it("only accepts a real object (not an array) for Clay_Full_Data", () => {
    expect(fromRecord({ Clay_Full_Data: { a: 1 } }).clayFullData).toEqual({ a: 1 });
    expect(fromRecord({ Clay_Full_Data: [1, 2, 3] }).clayFullData).toBeNull();
  });
});
