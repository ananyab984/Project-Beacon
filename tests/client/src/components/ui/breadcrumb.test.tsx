import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

describe("Breadcrumb", () => {
  it("renders a nav with breadcrumb aria-label", () => {
    render(<Breadcrumb data-testid="crumbs" />);
    const nav = screen.getByTestId("crumbs");
    expect(nav.tagName).toBe("NAV");
    expect(nav).toHaveAttribute("aria-label", "breadcrumb");
  });
});

describe("BreadcrumbList", () => {
  it("renders an ol with className merged", () => {
    render(<BreadcrumbList className="my-class" data-testid="list" />);
    const list = screen.getByTestId("list");
    expect(list.tagName).toBe("OL");
    expect(list).toHaveClass("my-class");
  });
});

describe("BreadcrumbItem", () => {
  it("renders an li with children", () => {
    render(
      <BreadcrumbItem>
        <span>Item</span>
      </BreadcrumbItem>,
    );
    expect(screen.getByText("Item").closest("li")).toBeInTheDocument();
  });
});

describe("BreadcrumbLink", () => {
  it("renders an anchor by default", () => {
    render(<BreadcrumbLink href="/home">Home</BreadcrumbLink>);
    const link = screen.getByText("Home");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/home");
  });

  it("renders the child element when asChild is set", () => {
    render(
      <BreadcrumbLink asChild>
        <button type="button">Click</button>
      </BreadcrumbLink>,
    );
    const el = screen.getByText("Click");
    expect(el.tagName).toBe("BUTTON");
  });
});

describe("BreadcrumbPage", () => {
  it("renders current page with aria attributes", () => {
    render(<BreadcrumbPage>Current</BreadcrumbPage>);
    const page = screen.getByText("Current");
    expect(page).toHaveAttribute("aria-current", "page");
    expect(page).toHaveAttribute("aria-disabled", "true");
    expect(page).toHaveAttribute("role", "link");
  });
});

describe("BreadcrumbSeparator", () => {
  it("renders a default chevron icon when no children given", () => {
    const { container } = render(<BreadcrumbSeparator />);
    expect(container.querySelector("li")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders custom children instead of the default icon", () => {
    render(<BreadcrumbSeparator>/</BreadcrumbSeparator>);
    expect(screen.getByText("/")).toBeInTheDocument();
  });
});

describe("BreadcrumbEllipsis", () => {
  it("renders a visually-hidden 'More' label", () => {
    render(<BreadcrumbEllipsis />);
    expect(screen.getByText("More")).toHaveClass("sr-only");
  });
});
