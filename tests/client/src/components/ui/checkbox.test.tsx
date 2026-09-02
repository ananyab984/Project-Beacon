import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";

describe("Checkbox", () => {
  it("toggles from unchecked to checked on click", async () => {
    const user = userEvent.setup();
    render(<Checkbox />);
    const el = screen.getByRole("checkbox");
    expect(el).toHaveAttribute("data-state", "unchecked");
    await user.click(el);
    expect(el).toHaveAttribute("data-state", "checked");
    expect(el).toHaveAttribute("aria-checked", "true");
  });

  it("renders indeterminate state", () => {
    render(<Checkbox checked="indeterminate" />);
    const el = screen.getByRole("checkbox");
    expect(el).toHaveAttribute("data-state", "indeterminate");
    expect(el).toHaveAttribute("aria-checked", "mixed");
  });

  it("does not toggle when disabled", async () => {
    const user = userEvent.setup();
    render(<Checkbox disabled />);
    const el = screen.getByRole("checkbox");
    expect(el).toBeDisabled();
    await user.click(el);
    expect(el).toHaveAttribute("data-state", "unchecked");
  });

  it("calls onCheckedChange with new state", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole("checkbox"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
