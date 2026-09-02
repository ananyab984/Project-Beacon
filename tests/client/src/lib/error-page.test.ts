import { describe, it, expect } from "vitest";
import { renderErrorPage } from "@/lib/error-page";

describe("renderErrorPage", () => {
  it("returns a full html document", () => {
    const html = renderErrorPage();
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<title>This page didn't load</title>");
  });
  it("includes a reload action and a home link", () => {
    const html = renderErrorPage();
    expect(html).toContain("onclick=\"location.reload()\"");
    expect(html).toContain('href="/"');
  });
});
