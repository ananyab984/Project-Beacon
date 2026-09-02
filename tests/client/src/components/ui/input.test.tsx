import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";

describe("Input", () => {
  it("accepts typed input", async () => {
    const user = userEvent.setup();
    render(<Input placeholder="email" />);
    const el = screen.getByPlaceholderText("email");
    await user.type(el, "a@b.com");
    expect(el).toHaveValue("a@b.com");
  });

  it("forwards type, className and ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input type="password" className="my-class" ref={ref} />);
    expect(ref.current).toHaveAttribute("type", "password");
    expect(ref.current).toHaveClass("my-class");
  });
});
