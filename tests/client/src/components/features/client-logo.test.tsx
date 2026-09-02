import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClientLogo } from "@/components/features/client-logo";

describe("ClientLogo", () => {
  it("matches Netflix and renders its brand label", () => {
    render(<ClientLogo name="Netflix" />);
    expect(screen.getByText("N")).toBeInTheDocument();
    expect(screen.getByTitle("Netflix")).toBeInTheDocument();
  });

  it("matches a partial/substring brand name (Amazon Prime Video)", () => {
    render(<ClientLogo name="Amazon Prime Video" />);
    expect(screen.getByText("prime")).toBeInTheDocument();
  });

  it("matches 'amazon' alone to the same prime config", () => {
    render(<ClientLogo name="Amazon Studios" />);
    expect(screen.getByText("prime")).toBeInTheDocument();
  });

  it("matches Disney+", () => {
    render(<ClientLogo name="Disney+" />);
    expect(screen.getByText("D+")).toBeInTheDocument();
  });

  it("matches Warner Bros. Discovery", () => {
    render(<ClientLogo name="Warner Bros. Discovery" />);
    expect(screen.getByText("WB")).toBeInTheDocument();
  });

  it("matches Apple TV+", () => {
    render(<ClientLogo name="Apple TV+" />);
    // Label embeds the Apple logo glyph (U+F8FF) before "TV+".
    expect(screen.getByText((content) => content.endsWith("TV+"))).toBeInTheDocument();
  });

  it("matches HBO, Paramount, Sony and Universal", () => {
    render(<ClientLogo name="HBO Max" />);
    expect(screen.getByText("HBO")).toBeInTheDocument();
    render(<ClientLogo name="Paramount Pictures" />);
    expect(screen.getByText("P+")).toBeInTheDocument();
    render(<ClientLogo name="Sony Pictures" />);
    expect(screen.getByText("SONY")).toBeInTheDocument();
    render(<ClientLogo name="Universal Studios" />);
    expect(screen.getByText("UNI")).toBeInTheDocument();
  });

  it("is case-insensitive and trims whitespace when matching", () => {
    render(<ClientLogo name="  NETFLIX  " />);
    expect(screen.getByText("N")).toBeInTheDocument();
  });

  it("falls back to initials for an unknown brand", () => {
    render(<ClientLogo name="Acme Studios" />);
    expect(screen.getByText("AS")).toBeInTheDocument();
  });

  it("falls back to a single initial for a one-word unknown name", () => {
    render(<ClientLogo name="Zenith" />);
    expect(screen.getByText("Z")).toBeInTheDocument();
  });

  it("falls back to 'CL' when no initials can be derived", () => {
    render(<ClientLogo name="   " />);
    expect(screen.getByText("CL")).toBeInTheDocument();
  });

  it("applies the requested size classes", () => {
    render(<ClientLogo name="Netflix" size="lg" />);
    expect(screen.getByTitle("Netflix")).toHaveClass("h-10", "w-10", "text-sm");
  });

  it("defaults to the md size", () => {
    render(<ClientLogo name="Netflix" />);
    expect(screen.getByTitle("Netflix")).toHaveClass("h-8", "w-8", "text-xs");
  });

  it("forwards a custom className", () => {
    render(<ClientLogo name="Netflix" className="ring-1" />);
    expect(screen.getByTitle("Netflix")).toHaveClass("ring-1");
  });
});
