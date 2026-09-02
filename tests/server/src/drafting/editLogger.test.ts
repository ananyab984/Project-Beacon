import { describe, it, expect } from "vitest";
import { logRecruiterEdit } from "@server/drafting/editLogger";

describe("logRecruiterEdit", () => {
  it("reports was_edited=false and 0% edit for identical original/edited text", () => {
    const result = logRecruiterEdit("draft-1", "Hello there", "Hello there");
    expect(result.was_edited).toBe(false);
    expect(result.edit_percentage).toBe(0);
    expect(result.similarity_score).toBe(1);
  });

  it("reports was_edited=true and a positive edit_percentage for changed text", () => {
    const result = logRecruiterEdit("draft-1", "Hello there friend", "Hi there buddy");
    expect(result.was_edited).toBe(true);
    expect(result.edit_percentage).toBeGreaterThan(0);
    expect(result.similarity_score).toBeLessThan(1);
  });

  it("handles null/undefined-ish empty strings without crashing", () => {
    const result = logRecruiterEdit("draft-1", "", "");
    expect(result.original_length).toBe(0);
    expect(result.edited_length).toBe(0);
    expect(result.was_edited).toBe(false);
  });

  it("carries through original_length and edited_length correctly", () => {
    const result = logRecruiterEdit("draft-1", "abc", "abcdef");
    expect(result.original_length).toBe(3);
    expect(result.edited_length).toBe(6);
  });

  it("passes through the draft_id unchanged", () => {
    const result = logRecruiterEdit("my-draft-id", "a", "b");
    expect(result.draft_id).toBe("my-draft-id");
  });
});
