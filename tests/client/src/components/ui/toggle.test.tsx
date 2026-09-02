import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Toggle } from "@/components/ui/toggle";

describe("Toggle", () => {
  it("renders unpressed by default", () => {
    render(<Toggle>Bold</Toggle>);
    const toggle = screen.getByRole("button", { name: "Bold" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("data-state", "off");
  });

  it("toggles pressed state on click", async () => {
    const user = userEvent.setup();
    render(<Toggle>Bold</Toggle>);
    const toggle = screen.getByRole("button", { name: "Bold" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAttribute("data-state", "on");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("data-state", "off");
  });

  it("respects the pressed/defaultPressed prop", () => {
    render(<Toggle defaultPressed>Bold</Toggle>);
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "on");
  });

  it("applies the outline variant classes", () => {
    render(<Toggle variant="outline">Bold</Toggle>);
    expect(screen.getByRole("button")).toHaveClass("border-input");
  });

  it("applies the requested size", () => {
    render(<Toggle size="sm">Bold</Toggle>);
    expect(screen.getByRole("button")).toHaveClass("h-8");
  });

  it("does not toggle when disabled", async () => {
    const user = userEvent.setup();
    render(<Toggle disabled>Bold</Toggle>);
    const toggle = screen.getByRole("button", { name: "Bold" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });
});
