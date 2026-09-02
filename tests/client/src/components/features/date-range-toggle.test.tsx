import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DateRangeToggle,
  DateRangeSelect,
  RANGE_LABELS,
  RANGE_SCALE,
  scaleValue,
  setDateRange,
  useDateRange,
} from "@/components/features/date-range-toggle";
import { renderHook } from "@testing-library/react";

beforeEach(() => {
  window.localStorage.clear();
});

describe("pure helpers", () => {
  it("RANGE_LABELS and RANGE_SCALE cover all keys", () => {
    expect(RANGE_LABELS["7d"]).toBe("Last 7 days");
    expect(RANGE_LABELS["1y"]).toBe("Last year");
    expect(RANGE_SCALE["7d"]).toBe(0.25);
    expect(RANGE_SCALE["1y"]).toBe(12);
  });

  it("scaleValue rounds and floors at zero", () => {
    expect(scaleValue(10, 0.25)).toBe(3);
    expect(scaleValue(-5, 1)).toBe(0);
    expect(scaleValue(10, 3)).toBe(30);
  });
});

describe("useDateRange", () => {
  it("defaults to 30d when localStorage is empty", () => {
    const { result } = renderHook(() => useDateRange());
    expect(result.current.range).toBe("30d");
    expect(result.current.scale).toBe(1);
    expect(result.current.label).toBe("Last 30 days");
  });

  it("reads a previously persisted value", () => {
    window.localStorage.setItem("g3:date-range", "90d");
    const { result } = renderHook(() => useDateRange());
    expect(result.current.range).toBe("90d");
  });

  it("ignores an invalid persisted value", () => {
    window.localStorage.setItem("g3:date-range", "bogus");
    const { result } = renderHook(() => useDateRange());
    expect(result.current.range).toBe("30d");
  });

  it("setDateRange persists and notifies subscribers", () => {
    const { result } = renderHook(() => useDateRange());
    act(() => setDateRange("1y"));
    expect(result.current.range).toBe("1y");
    expect(window.localStorage.getItem("g3:date-range")).toBe("1y");
  });

  it("unsubscribes cleanly on unmount", () => {
    const { unmount } = renderHook(() => useDateRange());
    expect(() => unmount()).not.toThrow();
  });
});

describe("DateRangeToggle", () => {
  it("renders a tab per range option with 30d active by default", () => {
    render(<DateRangeToggle />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "30d" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "7d" })).toHaveAttribute("aria-selected", "false");
  });

  it("selecting a tab updates the active state and persists it", async () => {
    const user = userEvent.setup();
    render(<DateRangeToggle />);
    await user.click(screen.getByRole("tab", { name: "90d" }));
    expect(screen.getByRole("tab", { name: "90d" })).toHaveAttribute("aria-selected", "true");
    expect(window.localStorage.getItem("g3:date-range")).toBe("90d");
  });

  it("forwards a custom className", () => {
    render(<DateRangeToggle className="extra" />);
    expect(screen.getByRole("tablist")).toHaveClass("extra");
  });
});

describe("DateRangeSelect", () => {
  it("shows the current range label on the trigger by default", () => {
    render(<DateRangeSelect />);
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
  });

  it("opens the popover and lists all presets", async () => {
    const user = userEvent.setup();
    render(<DateRangeSelect />);
    await user.click(screen.getByText("Last 30 days"));
    expect(screen.getByText("Preset Time Horizon")).toBeInTheDocument();
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText("Last year")).toBeInTheDocument();
  });

  it("selecting a preset updates the trigger label and closes the popover", async () => {
    const user = userEvent.setup();
    render(<DateRangeSelect />);
    await user.click(screen.getByText("Last 30 days"));
    await user.click(screen.getByText("Last 7 days"));
    expect(window.localStorage.getItem("g3:date-range")).toBe("7d");
    expect(screen.queryByText("Preset Time Horizon")).not.toBeInTheDocument();
  });

  it("picking a custom date shows a formatted 'Date:' label", async () => {
    const user = userEvent.setup();
    render(<DateRangeSelect />);
    await user.click(screen.getByText("Last 30 days"));
    const dateInput = screen.getByDisplayValue("");
    await user.type(dateInput, "2026-01-15");
    expect(screen.getByText("Date: 15/01/2026")).toBeInTheDocument();
  });

  it("ignores an empty custom date change", async () => {
    const user = userEvent.setup();
    render(<DateRangeSelect />);
    await user.click(screen.getByText("Last 30 days"));
    const dateInput = screen.getByDisplayValue("");
    fireEvent.change(dateInput, { target: { value: "" } });
    expect(screen.getByText("Preset Time Horizon")).toBeInTheDocument();
    expect(screen.queryByText(/^Date:/)).not.toBeInTheDocument();
  });

  it("cycles the scale to 30d when a custom date is picked while range is not 30d", async () => {
    setDateRange("90d");
    const user = userEvent.setup();
    render(<DateRangeSelect />);
    await user.click(screen.getByText("Last 90 days"));
    const dateInput = screen.getByDisplayValue("");
    await user.type(dateInput, "2026-02-01");
    expect(window.localStorage.getItem("g3:date-range")).toBe("30d");
  });
});
