import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "@/components/ui/skeleton";

describe("Skeleton", () => {
  it("renders a div with pulse styling", () => {
    const { container } = render(<Skeleton data-testid="skel" />);
    expect(container.firstChild).toHaveClass("animate-pulse");
  });

  it("merges custom className", () => {
    const { container } = render(<Skeleton className="my-class" />);
    expect(container.firstChild).toHaveClass("my-class");
    expect(container.firstChild).toHaveClass("animate-pulse");
  });
});
