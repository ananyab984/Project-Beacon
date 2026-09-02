import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

describe("Pagination", () => {
  it("renders nav with pagination role and label", () => {
    render(<Pagination data-testid="nav" />);
    const nav = screen.getByRole("navigation", { name: "pagination" });
    expect(nav).toBeInTheDocument();
  });

  it("renders links inside content/item wrappers", () => {
    render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationLink href="#">1</PaginationLink>
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("marks active link with aria-current and outline variant class", () => {
    render(
      <PaginationLink href="#" isActive>
        2
      </PaginationLink>,
    );
    const link = screen.getByText("2");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("border");
  });

  it("omits aria-current when not active", () => {
    render(
      <PaginationLink href="#" isActive={false}>
        3
      </PaginationLink>,
    );
    expect(screen.getByText("3")).not.toHaveAttribute("aria-current");
  });

  it("renders PaginationPrevious with icon and label", () => {
    render(<PaginationPrevious href="#" />);
    const link = screen.getByLabelText("Go to previous page");
    expect(link).toHaveTextContent("Previous");
  });

  it("renders PaginationNext with icon and label", () => {
    render(<PaginationNext href="#" />);
    const link = screen.getByLabelText("Go to next page");
    expect(link).toHaveTextContent("Next");
  });

  it("renders PaginationEllipsis with sr-only text and hidden from a11y tree", () => {
    render(<PaginationEllipsis />);
    expect(screen.getByText("More pages")).toBeInTheDocument();
    const wrapper = screen.getByText("More pages").parentElement;
    expect(wrapper).toHaveAttribute("aria-hidden");
  });
});
