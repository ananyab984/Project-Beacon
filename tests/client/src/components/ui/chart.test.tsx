import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ChartContainer,
  ChartLegendContent,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const config: ChartConfig = {
  desktop: { label: "Desktop", color: "#2563eb" },
  mobile: { label: "Mobile", theme: { light: "#f00", dark: "#0f0" } },
};

describe("ChartContainer", () => {
  it("renders children and sets a data-chart id on the wrapper", () => {
    const { container } = render(
      <ChartContainer config={config} id="test">
        <div />
      </ChartContainer>,
    );
    expect(container.querySelector('[data-chart="chart-test"]')).toBeInTheDocument();
  });

  it("emits a <style> tag with CSS vars for configs with color or theme", () => {
    const { container } = render(
      <ChartContainer config={config} id="test">
        <div />
      </ChartContainer>,
    );
    const style = container.querySelector("style");
    expect(style?.innerHTML).toContain("--color-desktop: #2563eb;");
    expect(style?.innerHTML).toContain("--color-mobile: #f00;");
    expect(style?.innerHTML).toContain(".dark [data-chart=chart-test]");
  });

  it("omits the style tag when no config entries have color/theme", () => {
    const { container } = render(
      <ChartContainer config={{ desktop: { label: "Desktop" } }} id="test">
        <div />
      </ChartContainer>,
    );
    expect(container.querySelector("style")).not.toBeInTheDocument();
  });
});

describe("ChartTooltipContent", () => {
  const payload = [
    {
      dataKey: "desktop",
      name: "desktop",
      value: 100,
      color: "#2563eb",
      payload: { fill: "#2563eb" },
    },
  ];

  it("renders nothing when inactive", () => {
    const { container } = render(
      <ChartContainer config={config}>
        <ChartTooltipContent active={false} payload={payload} />
      </ChartContainer>,
    );
    expect(container.querySelector(".grid.min-w-\\[8rem\\]")).not.toBeInTheDocument();
  });

  it("renders nothing when payload is empty", () => {
    const { container } = render(
      <ChartContainer config={config}>
        <ChartTooltipContent active payload={[]} />
      </ChartContainer>,
    );
    expect(container.querySelector(".grid.min-w-\\[8rem\\]")).not.toBeInTheDocument();
  });

  it("shows label, config label, and formatted value when active", () => {
    render(
      <ChartContainer config={config}>
        <ChartTooltipContent active payload={payload} label="desktop" />
      </ChartContainer>,
    );
    expect(screen.getAllByText("Desktop")).toHaveLength(2); // header label + item label
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("hides the label when hideLabel is set", () => {
    render(
      <ChartContainer config={config}>
        <ChartTooltipContent active payload={payload} label="desktop" hideLabel />
      </ChartContainer>,
    );
    // Item name label still renders (inside the row); only the header label is suppressed.
    expect(screen.getAllByText("Desktop")).toHaveLength(1);
  });

  it("uses a custom formatter when provided", () => {
    const formatter = vi.fn((value: unknown) => <span key="f">custom-{String(value)}</span>);
    render(
      <ChartContainer config={config}>
        <ChartTooltipContent active payload={payload} formatter={formatter} />
      </ChartContainer>,
    );
    expect(formatter).toHaveBeenCalled();
    expect(screen.getByText("custom-100")).toBeInTheDocument();
  });

  it("throws useChart error when rendered outside ChartContainer", () => {
    expect(() => render(<ChartTooltipContent active payload={payload} />)).toThrow(
      "useChart must be used within a <ChartContainer />",
    );
  });
});

describe("ChartLegendContent", () => {
  const payload = [
    { value: "desktop", dataKey: "desktop", color: "#2563eb", type: "line" },
    { value: "mobile", dataKey: "mobile", color: "#f00", type: "line" },
  ];

  it("renders nothing when payload is empty", () => {
    const { container } = render(
      <ChartContainer config={config}>
        <ChartLegendContent payload={[]} />
      </ChartContainer>,
    );
    expect(container.querySelector(".justify-center.gap-4")).not.toBeInTheDocument();
  });

  it("renders a legend entry per payload item using config labels", () => {
    render(
      <ChartContainer config={config}>
        <ChartLegendContent payload={payload} />
      </ChartContainer>,
    );
    expect(screen.getByText("Desktop")).toBeInTheDocument();
    expect(screen.getByText("Mobile")).toBeInTheDocument();
  });

  it("filters out entries with type 'none'", () => {
    render(
      <ChartContainer config={config}>
        <ChartLegendContent payload={[{ value: "x", dataKey: "desktop", type: "none" }]} />
      </ChartContainer>,
    );
    expect(screen.queryByText("Desktop")).not.toBeInTheDocument();
  });
});
