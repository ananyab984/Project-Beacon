import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

describe("Table", () => {
  it("renders a table wrapped in a scroll container", () => {
    render(
      <Table data-testid="table">
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByTestId("table");
    expect(table.tagName).toBe("TABLE");
    expect(table.parentElement).toHaveClass("overflow-auto");
  });

  it("merges custom className", () => {
    render(<Table data-testid="table" className="my-class" />);
    expect(screen.getByTestId("table")).toHaveClass("my-class");
  });
});

describe("TableHeader", () => {
  it("renders a thead", () => {
    render(
      <Table>
        <TableHeader data-testid="thead" />
      </Table>,
    );
    expect(screen.getByTestId("thead").tagName).toBe("THEAD");
  });
});

describe("TableBody", () => {
  it("renders a tbody", () => {
    render(
      <Table>
        <TableBody data-testid="tbody" />
      </Table>,
    );
    expect(screen.getByTestId("tbody").tagName).toBe("TBODY");
  });
});

describe("TableFooter", () => {
  it("renders a tfoot", () => {
    render(
      <Table>
        <TableFooter data-testid="tfoot" />
      </Table>,
    );
    expect(screen.getByTestId("tfoot").tagName).toBe("TFOOT");
  });
});

describe("TableRow", () => {
  it("renders a tr", () => {
    render(
      <Table>
        <TableBody>
          <TableRow data-testid="row" />
        </TableBody>
      </Table>,
    );
    expect(screen.getByTestId("row").tagName).toBe("TR");
  });
});

describe("TableHead", () => {
  it("renders a th with children", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    const th = screen.getByText("Name");
    expect(th.tagName).toBe("TH");
  });
});

describe("TableCell", () => {
  it("renders a td with children", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Value</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByText("Value").tagName).toBe("TD");
  });
});

describe("TableCaption", () => {
  it("renders a caption with children", () => {
    render(
      <Table>
        <TableCaption>My caption</TableCaption>
      </Table>,
    );
    expect(screen.getByText("My caption").tagName).toBe("CAPTION");
  });
});
