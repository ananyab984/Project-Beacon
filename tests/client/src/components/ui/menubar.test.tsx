import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar";

function Basic({ onSelect }: { onSelect?: () => void }) {
  return (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={onSelect}>New Tab</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>Undo</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

describe("Menubar", () => {
  it("does not render menu items by default", () => {
    render(<Basic />);
    expect(screen.queryByText("New Tab")).not.toBeInTheDocument();
  });

  it("opens a menu on its trigger click and shows its items", async () => {
    const user = userEvent.setup();
    render(<Basic />);
    await user.click(screen.getByText("File"));
    expect(screen.getByText("New Tab")).toBeInTheDocument();
    expect(screen.queryByText("Undo")).not.toBeInTheDocument();
  });

  it("fires onSelect when an item is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Basic onSelect={onSelect} />);
    await user.click(screen.getByText("File"));
    await user.click(screen.getByText("New Tab"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
