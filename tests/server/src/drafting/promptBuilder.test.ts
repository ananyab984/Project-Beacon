import { describe, it, expect } from "vitest";
import { buildEmailPrompt, buildLinkedinPrompt, BRAND } from "@server/drafting/promptBuilder";
import { Lead } from "@server/drafting/leads";

describe("buildEmailPrompt", () => {
  it("includes the lead's grounding facts in the user prompt", () => {
    const lead = new Lead({ firstName: "Jane", targetLanguage: "German", country: "Germany" });
    const [, user] = buildEmailPrompt(lead);
    expect(user).toContain("first_name: Jane");
    expect(user).toContain("target_language: German");
    expect(user).toContain("country: Germany");
  });

  it("includes every brand constant (site, apply URL, contact email)", () => {
    const lead = new Lead({ firstName: "Jane" });
    const [, user] = buildEmailPrompt(lead);
    expect(user).toContain(BRAND.site);
    expect(user).toContain(BRAND.apply_url);
    expect(user).toContain(BRAND.contact_email);
  });

  it("shows 'no rate card match' guidance when no rateMatch is passed", () => {
    const lead = new Lead({ firstName: "Jane" });
    const [, user] = buildEmailPrompt(lead, null);
    expect(user).toContain("No rate card match");
    expect(user).toContain("Do NOT mention any dollar amount");
  });

  it("shows the validated rate when a rateMatch is passed", () => {
    const lead = new Lead({ firstName: "Jane" });
    const [, user] = buildEmailPrompt(lead, { currency: "USD", rate: 0.12, unit: "per word" });
    expect(user).toContain("Validated Rate Card: USD $0.12 per word");
  });

  it("shows '(none -- ...)' for raw data when the lead has neither clayFullData nor rawScrapeData", () => {
    const lead = new Lead({ firstName: "Jane" });
    const [, user] = buildEmailPrompt(lead);
    expect(user).toContain("(none -- no additional raw enrichment data available");
  });

  it("includes a labeled Clay section when clayFullData is present", () => {
    const lead = new Lead({ firstName: "Jane", clayFullData: { connections: 500 } });
    const [, user] = buildEmailPrompt(lead);
    expect(user).toContain("--- From Clay ---");
    expect(user).toContain("500");
  });

  it("includes a labeled scrape section when rawScrapeData is present", () => {
    const lead = new Lead({ firstName: "Jane", rawScrapeData: { headline: "Freelancer" } });
    const [, user] = buildEmailPrompt(lead);
    expect(user).toContain("--- From the primary scrape (Bright Data/Tavily) ---");
  });

  it("truncates a very large raw data block rather than sending it unbounded", () => {
    const huge = { blob: "x".repeat(10_000) };
    const lead = new Lead({ firstName: "Jane", clayFullData: huge });
    const [, user] = buildEmailPrompt(lead);
    expect(user).toContain("(truncated");
  });

  it("returns the same system prompt (VOICE_RULES) regardless of lead content", () => {
    const [systemA] = buildEmailPrompt(new Lead({ firstName: "A" }));
    const [systemB] = buildEmailPrompt(new Lead({ firstName: "B", country: "France" }));
    expect(systemA).toBe(systemB);
  });
});

describe("buildLinkedinPrompt", () => {
  it("mentions the strict 200-character cap", () => {
    const [, user] = buildLinkedinPrompt(new Lead({ firstName: "Jane" }));
    expect(user).toContain("200 CHARACTERS");
  });

  it("includes the apply URL but not the email-only signoff instruction", () => {
    const [, user] = buildLinkedinPrompt(new Lead({ firstName: "Jane" }));
    expect(user).toContain(BRAND.apply_url);
    expect(user).not.toContain("Resources Team");
  });

  it("includes grounding facts the same way the email prompt does", () => {
    const lead = new Lead({ firstName: "Jane", yearsOfExp: 7 });
    const [, user] = buildLinkedinPrompt(lead);
    expect(user).toContain("years_of_experience: 7 years");
  });
});
