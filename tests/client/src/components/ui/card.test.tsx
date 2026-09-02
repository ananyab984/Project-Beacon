import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

describe("Card", () => {
  it("renders children with card classes", () => {
    render(<Card data-testid="card">Body</Card>);
    const card = screen.getByTestId("card");
    expect(card).toHaveClass("rounded-xl");
    expect(card).toHaveTextContent("Body");
  });

  it("merges custom className", () => {
    render(<Card data-testid="card" className="my-class" />);
    expect(screen.getByTestId("card")).toHaveClass("my-class");
  });
});

describe("CardHeader", () => {
  it("renders with header classes", () => {
    render(<CardHeader data-testid="header" />);
    expect(screen.getByTestId("header")).toHaveClass("flex", "flex-col", "p-6");
  });
});

describe("CardTitle", () => {
  it("renders children with title classes", () => {
    render(<CardTitle>My Title</CardTitle>);
    expect(screen.getByText("My Title")).toHaveClass("font-semibold");
  });
});

describe("CardDescription", () => {
  it("renders children with description classes", () => {
    render(<CardDescription>My Description</CardDescription>);
    expect(screen.getByText("My Description")).toHaveClass("text-muted-foreground");
  });
});

describe("CardContent", () => {
  it("renders with content classes", () => {
    render(<CardContent data-testid="content">Body</CardContent>);
    expect(screen.getByTestId("content")).toHaveClass("p-6", "pt-0");
  });
});

describe("CardFooter", () => {
  it("renders with footer classes", () => {
    render(<CardFooter data-testid="footer">Footer</CardFooter>);
    expect(screen.getByTestId("footer")).toHaveClass("flex", "items-center");
  });
});
