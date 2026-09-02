import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, badgeVariants } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders children with default variant classes", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New")).toHaveClass("bg-primary");
  });

  it("applies the requested variant", () => {
    render(<Badge variant="destructive">Danger</Badge>);
    expect(screen.getByText("Danger")).toHaveClass("bg-destructive");
  });

  it("badgeVariants generates class strings", () => {
    expect(badgeVariants({ variant: "outline" })).toContain("text-foreground");
  });
});
