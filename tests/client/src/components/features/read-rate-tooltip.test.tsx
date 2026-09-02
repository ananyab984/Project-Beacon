import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ReadRateTooltip } from "@/components/features/read-rate-tooltip";

describe("ReadRateTooltip", () => {
  it("renders the default info icon trigger", () => {
    const { container } = render(<ReadRateTooltip />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders custom children as the trigger instead of the icon", () => {
    render(
      <ReadRateTooltip>
        <span>custom trigger</span>
      </ReadRateTooltip>,
    );
    expect(screen.getByText("custom trigger")).toBeInTheDocument();
  });

  it("shows the disclaimer copy on hover", async () => {
    const user = userEvent.setup();
    render(<ReadRateTooltip />);
    const trigger = screen.getByText((_, el) => el?.tagName === "SPAN" && el.classList.contains("cursor-help"));
    await user.hover(trigger);
    expect(
      await screen.findByText(/Apple Mail Privacy Protection auto-downloads images/i),
    ).toBeInTheDocument();
  });
});
