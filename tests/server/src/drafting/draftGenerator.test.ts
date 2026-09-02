import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateEmail, generateLinkedin, generateFaqReply, generateFaqKeywords } from "@server/drafting/draftGenerator";
import { Lead } from "@server/drafting/leads";
import { BRAND } from "@server/drafting/promptBuilder";

function makeClient(responses: string[]) {
  const chat = vi.fn();
  responses.forEach((text) => {
    chat.mockResolvedValueOnce({ text, model: "claude-sonnet-5", latency_ms: 100, prompt_tokens: 10, completion_tokens: 20 });
  });
  return { chat } as any;
}

const cfg: any = { genModel: "claude-sonnet-5", genTemperature: 0.5 };

beforeEach(() => vi.clearAllMocks());

describe("generateEmail", () => {
  it("returns a Draft built from the model's JSON response", async () => {
    const lead = new Lead({ firstName: "Jane" });
    const client = makeClient([JSON.stringify({ subject: "Hello", body: "Hi Jane, apply here: https://app.global3.io/apply. Visit: global3.io" })]);

    const draft = await generateEmail(client, cfg, lead);

    expect(draft.channel).toBe("email");
    expect(draft.subject).toBe("Hello");
    expect(draft.body).toContain("https://app.global3.io/apply");
    expect(client.chat).toHaveBeenCalledTimes(1);
  });

  it("appends the apply link when the model omits it", async () => {
    const lead = new Lead({ firstName: "Jane" });
    const client = makeClient([JSON.stringify({ subject: "Hello", body: "Hi Jane, we'd love to work with you." })]);

    const draft = await generateEmail(client, cfg, lead);

    expect(draft.body).toContain("Apply here: https://app.global3.io/apply");
  });

  it("does not add a separate 'Visit: site' line when the appended apply URL already contains the site domain as a substring", () => {
    // https://app.global3.io/apply already contains "global3.io", so
    // ensureLinks' own !text.includes(BRAND.site) check is satisfied by the
    // apply-link fallback it just appended -- confirmed real behavior, not
    // a bug: this documents it rather than assuming a separate line is added.
    expect(BRAND.apply_url).toContain(BRAND.site);
  });

  it("ensureLinks' separate 'Visit: site' branch is effectively unreachable for email, since BRAND.apply_url always contains BRAND.site as a substring", async () => {
    // Either the body already contained the apply URL (which itself
    // contains "global3.io"), or ensureLinks just appended
    // "Apply here: https://app.global3.io/apply" -- both cases satisfy the
    // site-mention check before it's ever evaluated. Documenting this real
    // behavior rather than asserting a scenario that can't actually occur.
    const lead = new Lead({ firstName: "Jane" });
    const client = makeClient([JSON.stringify({ subject: "Hello", body: "Hi Jane, get in touch to apply." })]);
    const draft = await generateEmail(client, cfg, lead);
    expect(draft.body).not.toContain("Visit:");
    expect(draft.body).toContain(BRAND.site); // satisfied via the apply URL itself
  });

  it("does not duplicate the apply link when the model already included it", async () => {
    const lead = new Lead({ firstName: "Jane" });
    const client = makeClient([JSON.stringify({ subject: "Hi", body: "Apply: https://app.global3.io/apply" })]);
    const draft = await generateEmail(client, cfg, lead);
    const occurrences = draft.body.split("https://app.global3.io/apply").length - 1;
    expect(occurrences).toBe(1);
  });

  it("falls back to a raw-text body when the model's output isn't valid JSON at all", async () => {
    const lead = new Lead({ firstName: "Jane" });
    const client = makeClient(["Not JSON at all, just prose."]);
    const draft = await generateEmail(client, cfg, lead);
    expect(draft.body).toContain("Not JSON at all, just prose.");
  });

  it("salvages JSON embedded in surrounding text/markdown fences", async () => {
    const lead = new Lead({ firstName: "Jane" });
    const client = makeClient(['```json\n{"subject": "Hi", "body": "Hello Jane"}\n```']);
    const draft = await generateEmail(client, cfg, lead);
    expect(draft.subject).toBe("Hi");
  });

  it("uses a default subject when the model provides none", async () => {
    const lead = new Lead({ firstName: "Jane" });
    const client = makeClient([JSON.stringify({ body: "Hi Jane" })]);
    const draft = await generateEmail(client, cfg, lead);
    expect(draft.subject).toContain("Freelance partnership with Global3");
  });

  it("regenerates once when the first draft cites no specific fact, and keeps the retry", async () => {
    const lead = new Lead({ firstName: "Jane", toolsSoftware: ["Aegisub"] });
    const client = makeClient([
      JSON.stringify({ subject: "Hi", body: "Generic body with no specific tool mentioned." }),
      JSON.stringify({ subject: "Hi", body: "We noticed your experience with Aegisub." }),
    ]);

    const draft = await generateEmail(client, cfg, lead);

    expect(client.chat).toHaveBeenCalledTimes(2);
    expect(draft.body).toContain("Aegisub");
  });

  it("does not regenerate when the lead has no specific facts to check against at all", async () => {
    const lead = new Lead({ firstName: "Jane" }); // no tools/certs/title/vendorExperience
    const client = makeClient([JSON.stringify({ subject: "Hi", body: "Generic body." })]);
    await generateEmail(client, cfg, lead);
    expect(client.chat).toHaveBeenCalledTimes(1);
  });

  it("passes rate_match and rate_flag through onto the returned Draft unchanged", async () => {
    const lead = new Lead({ firstName: "Jane" });
    const client = makeClient([JSON.stringify({ subject: "Hi", body: "Body" })]);
    const rateMatch = { currency: "USD", rate: 0.1, unit: "per word" };
    const draft = await generateEmail(client, cfg, lead, rateMatch, "SOME_FLAG");
    expect(draft.rate_match).toBe(rateMatch);
    expect(draft.rate_flag).toBe("SOME_FLAG");
  });
});

describe("generateLinkedin", () => {
  it("returns a Draft with subject always null", async () => {
    const lead = new Lead({ firstName: "Jane" });
    const client = makeClient([JSON.stringify({ body: "Hi Jane, apply: https://app.global3.io/apply" })]);
    const draft = await generateLinkedin(client, cfg, lead);
    expect(draft.channel).toBe("linkedin");
    expect(draft.subject).toBeNull();
  });

  it("ensureLinks does NOT append a 'Visit: site' line for linkedin (char-budget guardrail)", async () => {
    const lead = new Lead({ firstName: "Jane" });
    const client = makeClient([JSON.stringify({ body: "Hi Jane, interested?" })]);
    const draft = await generateLinkedin(client, cfg, lead);
    expect(draft.body).not.toContain("Visit:");
    expect(draft.body).toContain("Apply here: https://app.global3.io/apply");
  });

  it("regenerates once for a missing specific fact, same as email", async () => {
    const lead = new Lead({ firstName: "Jane", certifications: ["OOONA Certified"] });
    const client = makeClient([
      JSON.stringify({ body: "Generic note." }),
      JSON.stringify({ body: "Noticed your OOONA Certified background." }),
    ]);
    const draft = await generateLinkedin(client, cfg, lead);
    expect(client.chat).toHaveBeenCalledTimes(2);
    expect(draft.body).toContain("OOONA");
  });
});

describe("generateFaqReply", () => {
  it("returns the model's trimmed text as the reply body", async () => {
    const client = makeClient(["  Here's the answer to your question.  "]);
    const reply = await generateFaqReply(client, cfg, "When do I get paid?", "Payment timing", "Payments go out monthly.");
    expect(reply.body).toBe("Here's the answer to your question.");
  });

  it("passes the candidate question and FAQ content into the prompt", async () => {
    const client = makeClient(["Answer"]);
    await generateFaqReply(client, cfg, "My question", "FAQ Q", "FAQ A content");
    const [, user] = client.chat.mock.calls[0];
    expect(user).toContain("My question");
    expect(user).toContain("FAQ A content");
  });
});

describe("generateFaqKeywords", () => {
  it("parses a clean JSON keywords array", async () => {
    const client = makeClient([JSON.stringify({ keywords: ["payment", "schedule", "training"] })]);
    const result = await generateFaqKeywords(client, cfg, "Q", "A");
    expect(result.keywords).toEqual(["payment", "schedule", "training"]);
  });

  it("salvages keywords JSON embedded in surrounding text", async () => {
    const client = makeClient(['Sure! {"keywords": ["a", "b"]} hope that helps']);
    const result = await generateFaqKeywords(client, cfg, "Q", "A");
    expect(result.keywords).toEqual(["a", "b"]);
  });

  it("filters out non-string entries from the keywords array", async () => {
    const client = makeClient([JSON.stringify({ keywords: ["valid", 123, null, "also-valid"] })]);
    const result = await generateFaqKeywords(client, cfg, "Q", "A");
    expect(result.keywords).toEqual(["valid", "also-valid"]);
  });

  it("returns an empty array when keywords is missing entirely", async () => {
    const client = makeClient([JSON.stringify({ notKeywords: [] })]);
    const result = await generateFaqKeywords(client, cfg, "Q", "A");
    expect(result.keywords).toEqual([]);
  });

  it("throws when the response has no parseable JSON at all", async () => {
    const client = makeClient(["Completely unparseable prose with no braces"]);
    await expect(generateFaqKeywords(client, cfg, "Q", "A")).rejects.toThrow("Could not parse keywords");
  });
});
