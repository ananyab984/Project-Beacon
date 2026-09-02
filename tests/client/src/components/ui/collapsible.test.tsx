import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

describe("Collapsible", () => {
  it("hides content until trigger is clicked", async () => {
    const user = userEvent.setup();
    render(
      <Collapsible>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Hidden content</CollapsibleContent>
      </Collapsible>,
    );
    expect(screen.queryByText("Hidden content")).not.toBeInTheDocument();
    await user.click(screen.getByText("Toggle"));
    expect(screen.getByText("Hidden content")).toHaveAttribute("data-state", "open");
  });

  it("starts open when defaultOpen is set", () => {
    render(
      <Collapsible defaultOpen>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Visible content</CollapsibleContent>
      </Collapsible>,
    );
    expect(screen.getByText("Visible content")).toHaveAttribute("data-state", "open");
  });
});
