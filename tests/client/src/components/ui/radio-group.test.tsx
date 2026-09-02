import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

describe("RadioGroup", () => {
  it("selecting one item deselects the others", async () => {
    const user = userEvent.setup();
    render(
      <RadioGroup>
        <RadioGroupItem value="a" aria-label="a" />
        <RadioGroupItem value="b" aria-label="b" />
      </RadioGroup>,
    );
    const [a, b] = screen.getAllByRole("radio");
    await user.click(a);
    expect(a).toHaveAttribute("data-state", "checked");
    expect(b).toHaveAttribute("data-state", "unchecked");
    await user.click(b);
    expect(a).toHaveAttribute("data-state", "unchecked");
    expect(b).toHaveAttribute("data-state", "checked");
  });

  it("honors defaultValue", () => {
    render(
      <RadioGroup defaultValue="b">
        <RadioGroupItem value="a" aria-label="a" />
        <RadioGroupItem value="b" aria-label="b" />
      </RadioGroup>,
    );
    const [a, b] = screen.getAllByRole("radio");
    expect(a).toHaveAttribute("data-state", "unchecked");
    expect(b).toHaveAttribute("data-state", "checked");
  });

  it("calls onValueChange when selection changes", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <RadioGroup onValueChange={onValueChange}>
        <RadioGroupItem value="a" aria-label="a" />
        <RadioGroupItem value="b" aria-label="b" />
      </RadioGroup>,
    );
    await user.click(screen.getAllByRole("radio")[1]);
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("does not select a disabled item", async () => {
    const user = userEvent.setup();
    render(
      <RadioGroup>
        <RadioGroupItem value="a" aria-label="a" disabled />
      </RadioGroup>,
    );
    const a = screen.getByRole("radio");
    expect(a).toBeDisabled();
    await user.click(a);
    expect(a).toHaveAttribute("data-state", "unchecked");
  });
});
