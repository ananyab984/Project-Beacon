import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiTile, ScoreRing } from "@/components/features/kpi";

describe("KpiTile", () => {
  it("formats a pct value with a % suffix", () => {
    render(<KpiTile label="Reply rate" value={42} unit="pct" />);
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("formats a days value with one decimal and a d suffix", () => {
    render(<KpiTile label="Time to fill" value={12.345} unit="days" />);
    expect(screen.getByText("12.3d")).toBeInTheDocument();
  });

  it("formats a score value as a plain string", () => {
    render(<KpiTile label="Score" value={87} unit="score" />);
    expect(screen.getByText("87")).toBeInTheDocument();
  });

  it("renders a string value as-is regardless of unit", () => {
    render(<KpiTile label="Status" value="N/A" unit="pct" />);
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });

  it("shows an upward trend with a rounded pct delta", () => {
    const { container } = render(<KpiTile label="Reply rate" value={42} unit="pct" trend={5.6} />);
    expect(screen.getByText("6%")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("shows a downward trend using the absolute value", () => {
    render(<KpiTile label="Reply rate" value={42} unit="pct" trend={-3} />);
    expect(screen.getByText("3%")).toBeInTheDocument();
  });

  it("formats a days trend with one decimal", () => {
    render(<KpiTile label="Time to fill" value={10} unit="days" trend={-2.5} />);
    expect(screen.getByText("2.5d")).toBeInTheDocument();
  });

  it("formats a score trend with no unit suffix", () => {
    render(<KpiTile label="Score" value={80} unit="score" trend={4} />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("omits the trend indicator when trend is undefined", () => {
    const { container } = render(<KpiTile label="Reply rate" value={42} />);
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("applies critical/warning/positive/neutral tone classes", () => {
    const { rerender } = render(<KpiTile label="x" value={1} tone="critical" />);
    expect(screen.getByText("1%")).toHaveClass("text-destructive");
    rerender(<KpiTile label="x" value={1} tone="warning" />);
    expect(screen.getByText("1%")).toHaveClass("text-warning");
    rerender(<KpiTile label="x" value={1} tone="positive" />);
    expect(screen.getByText("1%")).toHaveClass("text-accent");
    rerender(<KpiTile label="x" value={1} tone="neutral" />);
    expect(screen.getByText("1%")).toHaveClass("text-foreground");
  });

  it("renders an optional hint and context line", () => {
    render(<KpiTile label="x" value={1} hint="hint copy" context="context copy" />);
    expect(screen.getByText("hint copy")).toBeInTheDocument();
    expect(screen.getByText("context copy")).toBeInTheDocument();
  });

  it("omits hint/context when not provided", () => {
    render(<KpiTile label="x" value={1} />);
    expect(screen.queryByText("hint copy")).not.toBeInTheDocument();
  });
});

describe("ScoreRing", () => {
  it("renders the clamped score and default label", () => {
    render(<ScoreRing score={85} />);
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(screen.getByText("Strong")).toBeInTheDocument();
  });

  it("clamps a score above 100 down to 100", () => {
    render(<ScoreRing score={140} />);
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("clamps a negative score up to 0", () => {
    render(<ScoreRing score={-10} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("At risk")).toBeInTheDocument();
  });

  it("labels 60-79 as On track and 40-59 as Needs attention", () => {
    const { rerender } = render(<ScoreRing score={65} />);
    expect(screen.getByText("On track")).toBeInTheDocument();
    rerender(<ScoreRing score={45} />);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it("renders a custom label and size", () => {
    render(<ScoreRing score={90} size={64} label="Fit" />);
    expect(screen.getByText("Fit")).toBeInTheDocument();
  });
});
