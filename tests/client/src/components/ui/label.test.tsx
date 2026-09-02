import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Label } from "@/components/ui/label";

describe("Label", () => {
  it("renders text and forwards className", () => {
    render(<Label className="my-class">Name</Label>);
    const label = screen.getByText("Name");
    expect(label).toHaveClass("my-class");
    expect(label.tagName).toBe("LABEL");
  });

  it("forwards ref to the underlying element", () => {
    const ref = createRef<HTMLLabelElement>();
    render(<Label ref={ref}>Name</Label>);
    expect(ref.current).toBeInstanceOf(HTMLLabelElement);
  });
});
