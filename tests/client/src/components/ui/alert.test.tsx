import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

describe("Alert", () => {
  it("renders with default variant classes and role", () => {
    render(<Alert>Heads up</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("bg-background");
    expect(alert).toHaveTextContent("Heads up");
  });

  it("applies the destructive variant", () => {
    render(<Alert variant="destructive">Danger</Alert>);
    expect(screen.getByRole("alert")).toHaveClass("text-destructive");
  });

  it("merges custom className", () => {
    render(<Alert className="my-class">Content</Alert>);
    expect(screen.getByRole("alert")).toHaveClass("my-class");
  });

  it("forwards ref to the root element", () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<Alert ref={ref}>Content</Alert>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe("AlertTitle", () => {
  it("renders children in an h5", () => {
    render(<AlertTitle>Title text</AlertTitle>);
    const title = screen.getByText("Title text");
    expect(title.tagName).toBe("H5");
    expect(title).toHaveClass("font-medium");
  });
});

describe("AlertDescription", () => {
  it("renders children with description classes", () => {
    render(<AlertDescription>Description text</AlertDescription>);
    expect(screen.getByText("Description text")).toHaveClass("text-sm");
  });
});
