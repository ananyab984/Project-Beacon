import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

// vaul reads window.matchMedia to detect the background-scaling media query, and calls
// pointer-capture APIs on drag handlers; jsdom implements neither.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
});

function Basic() {
  return (
    <Drawer>
      <DrawerTrigger>Open</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Drawer title</DrawerTitle>
          <DrawerDescription>Drawer description.</DrawerDescription>
        </DrawerHeader>
        <DrawerClose>Close</DrawerClose>
      </DrawerContent>
    </Drawer>
  );
}

describe("Drawer", () => {
  it("does not render content by default", () => {
    render(<Basic />);
    expect(screen.queryByText("Drawer title")).not.toBeInTheDocument();
  });

  it("opens on trigger click and shows title/description", async () => {
    const user = userEvent.setup();
    render(<Basic />);
    await user.click(screen.getByText("Open"));
    expect(screen.getByText("Drawer title")).toBeInTheDocument();
    expect(screen.getByText("Drawer description.")).toBeInTheDocument();
  });

  it("closes via the close action", async () => {
    const user = userEvent.setup();
    render(<Basic />);
    await user.click(screen.getByText("Open"));
    await user.click(screen.getByText("Close"));
    expect(screen.queryByText("Drawer title")).not.toBeInTheDocument();
  });
});
