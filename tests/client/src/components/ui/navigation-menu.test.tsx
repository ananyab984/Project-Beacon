import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";

// Radix's viewport sizing observes content with ResizeObserver, which jsdom doesn't implement.
beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

function Basic() {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Products</NavigationMenuTrigger>
          <NavigationMenuContent>
            <NavigationMenuLink href="/widgets">Widgets</NavigationMenuLink>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}

describe("NavigationMenu", () => {
  it("renders the trigger without content visible by default", () => {
    render(<Basic />);
    expect(screen.getByText("Products")).toBeInTheDocument();
    expect(screen.queryByText("Widgets")).not.toBeInTheDocument();
  });

  it("reveals content on trigger click", async () => {
    const user = userEvent.setup();
    render(<Basic />);
    await user.click(screen.getByText("Products"));
    expect(await screen.findByText("Widgets")).toBeInTheDocument();
  });
});
