import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

function Basic({ side }: { side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Sheet>
      <SheetTrigger>Open</SheetTrigger>
      <SheetContent side={side}>
        <SheetHeader>
          <SheetTitle>Sheet title</SheetTitle>
          <SheetDescription>Sheet description.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}

describe("Sheet", () => {
  it("does not render content by default", () => {
    render(<Basic />);
    expect(screen.queryByText("Sheet title")).not.toBeInTheDocument();
  });

  it("opens on trigger click and shows title/description with dialog role", async () => {
    const user = userEvent.setup();
    render(<Basic />);
    await user.click(screen.getByText("Open"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Sheet title")).toBeInTheDocument();
    expect(screen.getByText("Sheet description.")).toBeInTheDocument();
  });

  it("closes via the close button", async () => {
    const user = userEvent.setup();
    render(<Basic />);
    await user.click(screen.getByText("Open"));
    await user.click(screen.getByText("Close"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("applies side variant classes to content", async () => {
    const user = userEvent.setup();
    render(<Basic side="left" />);
    await user.click(screen.getByText("Open"));
    expect(screen.getByRole("dialog")).toHaveClass("left-0");
  });
});
