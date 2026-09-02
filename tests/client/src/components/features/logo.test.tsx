import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { G3Logo } from "@/components/features/logo";

describe("G3Logo", () => {
  it("renders the Global3 wordmark", () => {
    render(<G3Logo />);
    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders the svg mark", () => {
    const { container } = render(<G3Logo />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelectorAll("line")).toHaveLength(22);
  });

  it("applies a custom className to the wrapper", () => {
    const { container } = render(<G3Logo className="tint-owner" />);
    expect(container.firstElementChild).toHaveClass("tint-owner");
  });

  it("defaults to no extra className", () => {
    const { container } = render(<G3Logo />);
    expect(container.firstElementChild).toHaveClass("flex", "items-center", "gap-2");
  });
});
