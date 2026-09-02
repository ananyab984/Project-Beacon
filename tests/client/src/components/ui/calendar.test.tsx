import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Calendar } from "@/components/ui/calendar";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("Calendar", () => {
  it("renders a days grid for the given month", () => {
    render(<Calendar mode="single" defaultMonth={new Date(2026, 0, 1)} />);
    expect(screen.getByText("January 2026")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked date in single mode", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Calendar mode="single" defaultMonth={new Date(2026, 0, 1)} onSelect={onSelect} />,
    );
    await user.click(screen.getByText("15"));
    expect(onSelect).toHaveBeenCalled();
    const selected = onSelect.mock.calls[0][0] as Date;
    expect(selected.getDate()).toBe(15);
    expect(selected.getMonth()).toBe(0);
  });

  it("navigates to the next month when the next button is clicked", async () => {
    const user = userEvent.setup();
    render(<Calendar mode="single" defaultMonth={new Date(2026, 0, 1)} />);
    expect(screen.getByText("January 2026")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/next/i));
    expect(await screen.findByText("February 2026")).toBeInTheDocument();
  });

  it("navigates to the previous month when the previous button is clicked", async () => {
    const user = userEvent.setup();
    render(<Calendar mode="single" defaultMonth={new Date(2026, 1, 1)} />);
    expect(screen.getByText("February 2026")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/previous/i));
    expect(await screen.findByText("January 2026")).toBeInTheDocument();
  });

  it("marks the selected day with data-selected-single", () => {
    render(
      <Calendar mode="single" defaultMonth={new Date(2026, 0, 1)} selected={new Date(2026, 0, 15)} />,
    );
    expect(screen.getByText("15").closest("button")).toHaveAttribute(
      "data-selected-single",
      "true",
    );
  });
});
