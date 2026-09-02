import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
});

function Basic() {
  return (
    <Command>
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Fruits">
          <CommandItem value="apple">Apple</CommandItem>
          <CommandItem value="banana">Banana</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

describe("Command", () => {
  it("renders all items by default", () => {
    render(<Basic />);
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
  });

  it("filters items as the user types", async () => {
    const user = userEvent.setup();
    render(<Basic />);
    await user.type(screen.getByPlaceholderText("Search..."), "app");
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.queryByText("Banana")).not.toBeInTheDocument();
  });

  it("shows CommandEmpty when no items match", async () => {
    const user = userEvent.setup();
    render(<Basic />);
    await user.type(screen.getByPlaceholderText("Search..."), "zzz");
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  it("fires onSelect when an item is chosen", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Command>
        <CommandList>
          <CommandItem value="apple" onSelect={onSelect}>
            Apple
          </CommandItem>
        </CommandList>
      </Command>,
    );
    await user.click(screen.getByText("Apple"));
    expect(onSelect).toHaveBeenCalledWith("apple");
  });

  it("renders CommandSeparator and CommandShortcut", () => {
    render(
      <Command>
        <CommandList>
          <CommandItem>
            Item <CommandShortcut>⌘K</CommandShortcut>
          </CommandItem>
          <CommandSeparator data-testid="sep" />
        </CommandList>
      </Command>,
    );
    expect(screen.getByText("⌘K")).toBeInTheDocument();
    expect(screen.getByTestId("sep")).toBeInTheDocument();
  });
});
