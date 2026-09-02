import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

function Basic({ onSelect }: { onSelect?: () => void }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>Right click me</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onSelect}>Reload</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

describe("ContextMenu", () => {
  it("does not render menu items by default", () => {
    render(<Basic />);
    expect(screen.queryByText("Reload")).not.toBeInTheDocument();
  });

  it("opens on right-click (contextmenu event) on the trigger", async () => {
    const user = userEvent.setup();
    render(<Basic />);
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Right click me") });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Reload")).toBeInTheDocument();
  });

  it("fires onSelect when an item is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Basic onSelect={onSelect} />);
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Right click me") });
    await user.click(screen.getByText("Reload"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
