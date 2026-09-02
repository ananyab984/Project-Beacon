import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

// openDelay/closeDelay set to 0 to avoid Radix's default hover timers being flaky in jsdom.
function Basic() {
  return (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger>Hover me</HoverCardTrigger>
      <HoverCardContent>Card body</HoverCardContent>
    </HoverCard>
  );
}

describe("HoverCard", () => {
  it("does not render content by default", () => {
    render(<Basic />);
    expect(screen.queryByText("Card body")).not.toBeInTheDocument();
  });

  it("opens on trigger hover", async () => {
    const user = userEvent.setup();
    render(<Basic />);
    await user.hover(screen.getByText("Hover me"));
    expect(await screen.findByText("Card body")).toBeInTheDocument();
  });

  it("is controllable via open prop", () => {
    const { rerender } = render(
      <HoverCard open={false}>
        <HoverCardTrigger>Hover me</HoverCardTrigger>
        <HoverCardContent>Card body</HoverCardContent>
      </HoverCard>,
    );
    expect(screen.queryByText("Card body")).not.toBeInTheDocument();
    rerender(
      <HoverCard open>
        <HoverCardTrigger>Hover me</HoverCardTrigger>
        <HoverCardContent>Card body</HoverCardContent>
      </HoverCard>,
    );
    expect(screen.getByText("Card body")).toBeInTheDocument();
  });
});
