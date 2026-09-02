import { describe, it, expect } from "vitest";
import { fleschReadingEase, fleschKincaidGrade } from "@server/drafting/readability";

describe("fleschReadingEase", () => {
  it("returns 0 for empty text", () => {
    expect(fleschReadingEase("")).toBe(0);
  });

  it("scores simple, short sentences higher (easier) than complex ones", () => {
    const simple = "The cat sat. The dog ran. I like cats.";
    const complex_ =
      "The multifaceted implementation necessitates comprehensive consideration of interdependent architectural ramifications.";
    expect(fleschReadingEase(simple)).toBeGreaterThan(fleschReadingEase(complex_));
  });

  it("clamps the score into [0, 100]", () => {
    const veryComplex = "Antidisestablishmentarianism ".repeat(20);
    const score = fleschReadingEase(veryComplex);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("fleschKincaidGrade", () => {
  it("returns 0 for empty text", () => {
    expect(fleschKincaidGrade("")).toBe(0);
  });

  it("never returns a negative grade level", () => {
    expect(fleschKincaidGrade("Hi.")).toBeGreaterThanOrEqual(0);
  });

  it("scores a more complex passage with a higher grade level than a simple one", () => {
    const simple = "The cat sat. The dog ran.";
    const complex_ = "The multifaceted implementation necessitates comprehensive interdisciplinary consideration.";
    expect(fleschKincaidGrade(complex_)).toBeGreaterThan(fleschKincaidGrade(simple));
  });
});
