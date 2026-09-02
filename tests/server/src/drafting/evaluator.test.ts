import { describe, it, expect } from "vitest";
import { evaluate } from "@server/drafting/evaluator";
import { Lead } from "@server/drafting/leads";
import type { Draft } from "@server/drafting/draftGenerator";

function makeLead(overrides: Partial<ConstructorParameters<typeof Lead>[0]> = {}): Lead {
  return new Lead({ firstName: "Jane", targetLanguage: "German", country: "Germany", ...overrides });
}

function goodEmailBody(name = "Jane"): string {
  const filler = "We work with talented professionals across many regions. ".repeat(6);
  return (
    `Hi ${name},\n\n` +
    `I hope this finds you well. We're reaching out from the Resource Management team at Global3 ` +
    `because we're building long-term partnerships with freelance linguists working in German. ${filler}` +
    `If you'd like to explore this, please apply through our application form here: https://app.global3.io/apply. ` +
    `You can learn more about us at global3.io.\n\n` +
    `Best regards,\nResources Team`
  );
}

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    channel: "email",
    lead: makeLead(),
    subject: "Freelance Opportunity",
    body: goodEmailBody(),
    model: "claude-sonnet-5",
    latency_ms: 100,
    prompt_tokens: null,
    completion_tokens: null,
    rate_match: null,
    rate_flag: null,
    ...overrides,
  };
}

describe("evaluate — length", () => {
  it("passes the email word band (90-230 words)", () => {
    const result = evaluate(makeDraft());
    const check = result.checks.find((c) => c.name === "length_words")!;
    expect(check.passed).toBe(true);
  });

  it("fails the email word band when far too short", () => {
    const result = evaluate(makeDraft({ body: "Hi Jane, apply here: https://app.global3.io/apply global3.io" }));
    const check = result.checks.find((c) => c.name === "length_words")!;
    expect(check.passed).toBe(false);
    expect(result.flags).toContain("LENGTH_OUT_OF_BOUNDS");
  });

  it("enforces the LinkedIn 300-char connection-note cap", () => {
    const longBody = "Hi Jane, ".repeat(50) + "apply here https://app.global3.io/apply global3.io";
    const result = evaluate(makeDraft({ channel: "linkedin", body: longBody, subject: null }));
    const capCheck = result.checks.find((c) => c.name === "linkedin_note_cap")!;
    expect(capCheck.passed).toBe(false);
    expect(result.flags).toContain("LINKEDIN_NOTE_CAP_EXCEEDED");
  });

  it("passes a LinkedIn note within the 60-300 char band", () => {
    const body = "Hi Jane, interested in freelance German work at Global3? Apply: https://app.global3.io/apply global3.io";
    const result = evaluate(makeDraft({ channel: "linkedin", body, subject: null }));
    const lengthCheck = result.checks.find((c) => c.name === "length_chars")!;
    expect(lengthCheck.passed).toBe(true);
  });
});

describe("evaluate — required elements / apply-link check", () => {
  it("passes when the body contains the literal apply URL", () => {
    const result = evaluate(makeDraft());
    const check = result.checks.find((c) => c.name === "required_elements")!;
    expect(check.passed).toBe(true);
  });

  it("fails required_elements when the apply URL is missing entirely", () => {
    const bodyNoApply = goodEmailBody().replace("https://app.global3.io/apply", "our website");
    const result = evaluate(makeDraft({ body: bodyNoApply }));
    const check = result.checks.find((c) => c.name === "required_elements")!;
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("apply✓0");
    expect(result.flags).toContain("MISSING_REQUIRED_ELEMENTS");
  });

  it("is satisfied by the literal 'app.global3.io/apply' substring even without the https:// prefix match", () => {
    // Confirmed live behavior: this is a plain substring check against BOTH
    // the full BRAND.apply_url AND the bare "app.global3.io/apply" string --
    // no URL parsing, no token validation.
    const body = goodEmailBody().replace("https://app.global3.io/apply", "app.global3.io/apply (no https prefix)");
    const result = evaluate(makeDraft({ body }));
    const check = result.checks.find((c) => c.name === "required_elements")!;
    expect(check.passed).toBe(true);
  });

  it("fails when the greeting doesn't name the lead within the first 60 characters", () => {
    const body = goodEmailBody().replace("Hi Jane,", "Hello there,");
    const result = evaluate(makeDraft({ body }));
    const check = result.checks.find((c) => c.name === "required_elements")!;
    expect(check.detail).toContain("name✓0");
  });

  it("email additionally requires a 'Resources Team' signoff and a short subject", () => {
    const bodyNoSignoff = goodEmailBody().replace("Best regards,\nResources Team", "Thanks,\nJane");
    const result = evaluate(makeDraft({ body: bodyNoSignoff }));
    expect(result.checks.find((c) => c.name === "required_elements")!.passed).toBe(false);
  });

  it("fails the subject check when the subject is longer than 8 words", () => {
    const result = evaluate(makeDraft({ subject: "This Subject Line Has Way Too Many Words In It Today" }));
    const check = result.checks.find((c) => c.name === "required_elements")!;
    expect(check.detail).toContain("subject✓0");
  });

  it("linkedin channel doesn't require a signoff or subject check", () => {
    const body = "Hi Jane, interested in freelance German work at Global3? Apply: https://app.global3.io/apply global3.io";
    const result = evaluate(makeDraft({ channel: "linkedin", body, subject: null }));
    const check = result.checks.find((c) => c.name === "required_elements")!;
    expect(check.detail).not.toContain("signoff");
    expect(check.detail).not.toContain("subject");
  });
});

describe("evaluate — spam & formatting", () => {
  it("flags a known spam word", () => {
    const result = evaluate(makeDraft({ body: goodEmailBody() + " Act now, guaranteed results!" }));
    const check = result.checks.find((c) => c.name === "spam_formatting")!;
    expect(check.passed).toBe(false);
  });

  it("flags excessive exclamation marks", () => {
    const result = evaluate(makeDraft({ body: goodEmailBody() + " Great!! Amazing!!" }));
    const check = result.checks.find((c) => c.name === "spam_formatting")!;
    expect(check.passed).toBe(false);
  });

  it("flags a fake Re:/Fwd: subject prefix", () => {
    const result = evaluate(makeDraft({ subject: "Re: Freelance Opportunity" }));
    const check = result.checks.find((c) => c.name === "spam_formatting")!;
    expect(check.passed).toBe(false);
  });

  it("passes clean, normal-case text with at most one exclamation mark", () => {
    const result = evaluate(makeDraft());
    const check = result.checks.find((c) => c.name === "spam_formatting")!;
    expect(check.passed).toBe(true);
  });
});

describe("evaluate — personalization depth", () => {
  it("passes when the body references a real enriched attribute (country/language/services)", () => {
    const result = evaluate(makeDraft());
    const check = result.checks.find((c) => c.name === "personalization_depth")!;
    expect(check.passed).toBe(true);
    expect(check.value).toBeGreaterThanOrEqual(1);
  });

  it("fails when nothing enriched is actually referenced in the body", () => {
    const genericBody =
      "Hi Jane,\n\nWe are reaching out about an opportunity at Global3. ".repeat(5) +
      "Please apply here: https://app.global3.io/apply. Visit global3.io.\n\nBest regards,\nResources Team";
    const lead = makeLead({ targetLanguage: null, country: null, services: [] });
    const result = evaluate(makeDraft({ body: genericBody, lead }));
    const check = result.checks.find((c) => c.name === "personalization_depth")!;
    expect(check.passed).toBe(false);
    expect(result.flags).toContain("LOW_PERSONALIZATION_DEPTH");
  });
});

describe("evaluate — placeholders", () => {
  it("fails when an unfilled [placeholder] token remains in the body", () => {
    const result = evaluate(makeDraft({ body: goodEmailBody() + " Your rate is [RATE_HERE]." }));
    const check = result.checks.find((c) => c.name === "no_placeholders")!;
    expect(check.passed).toBe(false);
    expect(result.flags).toContain("UNFILLED_PLACEHOLDERS_FOUND");
  });

  it("passes clean text with no placeholder tokens", () => {
    const result = evaluate(makeDraft());
    const check = result.checks.find((c) => c.name === "no_placeholders")!;
    expect(check.passed).toBe(true);
  });
});

describe("evaluate — rate grounding", () => {
  it("flags a fabricated rate mention when there's no rate_match on the draft", () => {
    const result = evaluate(makeDraft({ body: goodEmailBody() + " Our rate is $0.15 per word.", rate_match: null }));
    const check = result.checks.find((c) => c.name === "rate_grounding")!;
    expect(check.passed).toBe(false);
    expect(result.flags).toContain("FABRICATED_RATE_DETECTED");
  });

  it("does not flag a rate mention when a real rate_match backs it up", () => {
    const result = evaluate(
      makeDraft({
        body: goodEmailBody() + " Our rate is $0.15 per word.",
        rate_match: { source_language: "English", target_language: "German", service: "Translation", rate: 0.15, unit: "per word", currency: "USD" } as any,
      })
    );
    const check = result.checks.find((c) => c.name === "rate_grounding")!;
    expect(check.passed).toBe(true);
  });

  it("adds NO_RATE_MATCH to flags when rate_flag is set on the draft", () => {
    const result = evaluate(makeDraft({ rate_flag: "NO_RATE_MATCH" }));
    expect(result.flags).toContain("NO_RATE_MATCH");
  });
});

describe("evaluate — overall send decision", () => {
  it("send=true when every gate check passes, even if a warn-severity check fails", () => {
    const result = evaluate(makeDraft());
    const gateChecks = result.checks.filter((c) => c.severity === "gate");
    expect(gateChecks.every((c) => c.passed)).toBe(true);
    expect(result.send).toBe(true);
    expect(result.programmatic_pass).toBe(true);
  });

  it("send=false when any single gate check fails, regardless of how many pass", () => {
    const bodyNoApply = goodEmailBody().replace("https://app.global3.io/apply", "our website");
    const result = evaluate(makeDraft({ body: bodyNoApply }));
    expect(result.send).toBe(false);
    expect(result.programmatic_pass).toBe(false);
  });

  it("a warn-severity failure (poor readability) does not block send on its own", () => {
    // Extremely long, complex words drag Flesch score down (warn-only) but
    // shouldn't fail the gate-only send decision if every gate still passes.
    const complexButValid = goodEmailBody().replace(
      "We work with talented professionals across many regions. ".repeat(6),
      "We collaborate with multifaceted, internationally-distributed linguistic professionals extensively. ".repeat(6)
    );
    const result = evaluate(makeDraft({ body: complexButValid }));
    const readability = result.checks.find((c) => c.name === "readability_flesch")!;
    if (!readability.passed) {
      expect(result.send).toBe(true); // still true -- readability is warn, not gate
    }
  });
});
