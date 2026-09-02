import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Textarea } from "@/components/ui/textarea";

describe("Textarea", () => {
  it("accepts typed input", async () => {
    const user = userEvent.setup();
    render(<Textarea placeholder="notes" />);
    const el = screen.getByPlaceholderText("notes");
    await user.type(el, "hello");
    expect(el).toHaveValue("hello");
  });

  it("merges className and forwards ref", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea className="my-class" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(ref.current).toHaveClass("my-class");
  });
});
