import { describe, it, expect } from "vitest";
import { candidateRoleOf, buildLinkedInDraft } from "@server/lib/messageTemplates";

describe("candidateRoleOf", () => {
  it("joins multiple services with a comma", () => {
    expect(candidateRoleOf(["Subtitling", "Dubbing"], "German")).toBe("Subtitling, Dubbing");
  });

  it("falls back to targetLanguage when services is empty", () => {
    expect(candidateRoleOf([], "German")).toBe("German");
  });

  it("falls back to targetLanguage when services is null", () => {
    expect(candidateRoleOf(null, "German")).toBe("German");
  });

  it("falls back to 'Freelance Linguist' when both are empty", () => {
    expect(candidateRoleOf([], null)).toBe("Freelance Linguist");
    expect(candidateRoleOf(undefined, undefined)).toBe("Freelance Linguist");
  });

  it("trims whitespace-only targetLanguage down to the final fallback", () => {
    expect(candidateRoleOf([], "   ")).toBe("Freelance Linguist");
  });
});

describe("buildLinkedInDraft", () => {
  it("prefers displayName's first token over firstName/fullName", () => {
    const { body } = buildLinkedInDraft({
      fullName: "Full Name Here",
      firstName: "First",
      displayName: "Verified Name",
      sourceLanguage: null,
      targetLanguage: "German",
    });
    expect(body).toContain("Hi Verified,");
  });

  it("falls back to firstName when no displayName", () => {
    const { body } = buildLinkedInDraft({
      fullName: "Full Name",
      firstName: "Jane",
      sourceLanguage: null,
      targetLanguage: null,
    });
    expect(body).toContain("Hi Jane,");
  });

  it("falls back to the first token of fullName when no displayName/firstName", () => {
    const { body } = buildLinkedInDraft({
      fullName: "Jane Doe",
      firstName: null,
      sourceLanguage: null,
      targetLanguage: null,
    });
    expect(body).toContain("Hi Jane,");
  });

  it("falls back to 'there' when no name info exists at all", () => {
    const { body } = buildLinkedInDraft({ fullName: null, firstName: null, sourceLanguage: null, targetLanguage: null });
    expect(body).toContain("Hi there,");
  });

  it("prefers targetLanguage over sourceLanguage for the role phrase", () => {
    const { body } = buildLinkedInDraft({
      fullName: "Jane",
      firstName: null,
      sourceLanguage: "French",
      targetLanguage: "German",
    });
    expect(body).toContain("freelance Native German");
  });

  it("falls back to sourceLanguage when targetLanguage is empty", () => {
    const { body } = buildLinkedInDraft({ fullName: "Jane", firstName: null, sourceLanguage: "French", targetLanguage: null });
    expect(body).toContain("freelance Native French");
  });

  it("uses the generic phrase when no language is known at all", () => {
    const { body } = buildLinkedInDraft({ fullName: "Jane", firstName: null, sourceLanguage: null, targetLanguage: null });
    expect(body).toContain("freelance linguist to join us");
    expect(body).not.toContain("freelance Native");
  });

  it("always includes the apply link", () => {
    const { body } = buildLinkedInDraft({ fullName: "Jane", firstName: null, sourceLanguage: null, targetLanguage: null });
    expect(body).toContain("https://app.global3.io/apply");
  });
});
