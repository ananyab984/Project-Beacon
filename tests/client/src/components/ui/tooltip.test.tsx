import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function renderTooltip(open?: boolean) {
  return render(
    <TooltipProvider>
      <Tooltip open={open}>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Tooltip text</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
}

describe("Tooltip", () => {
  it("does not render content when closed", () => {
    renderTooltip(false);
    expect(screen.queryByText("Tooltip text")).not.toBeInTheDocument();
  });

  it("renders content when open", () => {
    renderTooltip(true);
    expect(screen.getByText("Tooltip text")).toBeInTheDocument();
  });

  it("renders the trigger as a button by default", () => {
    renderTooltip(false);
    expect(screen.getByText("Hover me").tagName).toBe("BUTTON");
  });

  it("merges custom className on content", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent className="my-class">Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByText("Tooltip text")).toHaveClass("my-class");
  });
});
