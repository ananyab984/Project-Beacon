import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "@/components/ui/switch";

describe("Switch", () => {
  it("toggles from unchecked to checked on click", async () => {
    const user = userEvent.setup();
    render(<Switch />);
    const el = screen.getByRole("switch");
    expect(el).toHaveAttribute("data-state", "unchecked");
    expect(el).toHaveAttribute("aria-checked", "false");
    await user.click(el);
    expect(el).toHaveAttribute("data-state", "checked");
    expect(el).toHaveAttribute("aria-checked", "true");
  });

  it("does not toggle when disabled", async () => {
    const user = userEvent.setup();
    render(<Switch disabled />);
    const el = screen.getByRole("switch");
    expect(el).toBeDisabled();
    await user.click(el);
    expect(el).toHaveAttribute("data-state", "unchecked");
  });

  it("supports controlled checked and onCheckedChange", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} />);
    const el = screen.getByRole("switch");
    await user.click(el);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(el).toHaveAttribute("data-state", "unchecked");
  });
});
