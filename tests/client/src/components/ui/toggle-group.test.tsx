import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

describe("ToggleGroup", () => {
  it("single type: selecting one item deselects the other", async () => {
    const user = userEvent.setup();
    render(
      <ToggleGroup type="single">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    );
    const a = screen.getByText("A");
    const b = screen.getByText("B");
    await user.click(a);
    expect(a).toHaveAttribute("data-state", "on");
    expect(a).toHaveAttribute("aria-checked", "true");
    expect(b).toHaveAttribute("data-state", "off");
    await user.click(b);
    expect(a).toHaveAttribute("data-state", "off");
    expect(b).toHaveAttribute("data-state", "on");
  });

  it("multiple type: allows more than one item pressed at once", async () => {
    const user = userEvent.setup();
    render(
      <ToggleGroup type="multiple">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    );
    const a = screen.getByText("A");
    const b = screen.getByText("B");
    await user.click(a);
    await user.click(b);
    expect(a).toHaveAttribute("data-state", "on");
    expect(a).toHaveAttribute("aria-pressed", "true");
    expect(b).toHaveAttribute("data-state", "on");
  });

  it("multiple type: clicking a pressed item toggles it off", async () => {
    const user = userEvent.setup();
    render(
      <ToggleGroup type="multiple">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    );
    const a = screen.getByText("A");
    await user.click(a);
    expect(a).toHaveAttribute("data-state", "on");
    await user.click(a);
    expect(a).toHaveAttribute("data-state", "off");
  });
});
