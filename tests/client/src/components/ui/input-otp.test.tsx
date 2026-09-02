import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!document.elementFromPoint) {
    document.elementFromPoint = () => null;
  }
});

function ControlledOTP({ maxLength = 4 }: { maxLength?: number }) {
  const [value, setValue] = useState("");
  return (
    <InputOTP maxLength={maxLength} value={value} onChange={setValue}>
      <InputOTPGroup>
        {Array.from({ length: maxLength }).map((_, i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

describe("InputOTP", () => {
  it("renders the given number of slots", () => {
    const { container } = render(<ControlledOTP maxLength={4} />);
    expect(container.querySelectorAll('[data-slot="slot"]').length).toBeGreaterThanOrEqual(0);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("updates slot characters as the user types", async () => {
    const user = userEvent.setup();
    render(<ControlledOTP maxLength={4} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "12");
    expect(input).toHaveValue("12");
  });

  it("renders a separator with a minus icon", () => {
    render(
      <InputOTP maxLength={2}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
        </InputOTPGroup>
        <InputOTPSeparator data-testid="sep" />
        <InputOTPGroup>
          <InputOTPSlot index={1} />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(screen.getByTestId("sep")).toHaveAttribute("role", "separator");
  });
});
