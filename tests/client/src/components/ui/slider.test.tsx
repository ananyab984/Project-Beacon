import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { Slider } from "@/components/ui/slider";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("Slider", () => {
  it("renders a slider input with given value", () => {
    const { container } = render(<Slider defaultValue={[40]} max={100} />);
    const thumb = container.querySelector('[role="slider"]');
    expect(thumb).toBeInTheDocument();
    expect(thumb).toHaveAttribute("aria-valuenow", "40");
  });

  it("merges custom className on root", () => {
    const { container } = render(<Slider className="my-class" defaultValue={[0]} />);
    expect(container.firstChild).toHaveClass("my-class");
  });
});
