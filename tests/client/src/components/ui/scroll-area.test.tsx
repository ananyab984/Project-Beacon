import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("ScrollArea", () => {
  it("renders children content", () => {
    render(
      <ScrollArea>
        <div>Scrollable content</div>
      </ScrollArea>,
    );
    expect(screen.getByText("Scrollable content")).toBeInTheDocument();
  });

  it("merges custom className on root", () => {
    const { container } = render(
      <ScrollArea className="my-class">
        <div>content</div>
      </ScrollArea>,
    );
    expect(container.firstChild).toHaveClass("my-class");
  });

  it("ScrollArea renders its own ScrollBar defaulting to vertical orientation", () => {
    const { container } = render(
      <ScrollArea type="always">
        <div>content</div>
      </ScrollArea>,
    );
    const bar = container.querySelector('[data-radix-scroll-area-viewport]')!.nextElementSibling;
    expect(bar).toHaveAttribute("data-orientation", "vertical");
  });

  it("ScrollBar honors horizontal orientation prop", () => {
    const { container } = render(
      <ScrollArea type="always">
        <ScrollBar orientation="horizontal" data-testid="bar" />
      </ScrollArea>,
    );
    const bar = container.querySelector('[data-testid="bar"]');
    expect(bar).toHaveAttribute("data-orientation", "horizontal");
    expect(bar).toHaveClass("h-2.5", "flex-col");
  });
});
