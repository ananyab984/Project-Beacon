import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

describe("Accordion", () => {
  it("expands an item's content when its trigger is clicked (single mode)", async () => {
    const user = userEvent.setup();
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="a">
          <AccordionTrigger>Item A</AccordionTrigger>
          <AccordionContent>Content A</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    expect(screen.queryByText("Content A")).not.toBeInTheDocument();
    await user.click(screen.getByText("Item A"));
    expect(screen.getByText("Content A").closest('[data-state]')).toHaveAttribute(
      "data-state",
      "open",
    );
  });

  it("collapses an open item when collapsible and clicked again", async () => {
    const user = userEvent.setup();
    render(
      <Accordion type="single" collapsible defaultValue="a">
        <AccordionItem value="a">
          <AccordionTrigger>Item A</AccordionTrigger>
          <AccordionContent>Content A</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    expect(screen.getByText("Content A").closest('[data-state]')).toHaveAttribute(
      "data-state",
      "open",
    );
    await user.click(screen.getByText("Item A"));
    expect(screen.queryByText("Content A")).not.toBeInTheDocument();
  });

  it("opening one item closes another in single mode", async () => {
    const user = userEvent.setup();
    render(
      <Accordion type="single" collapsible defaultValue="a">
        <AccordionItem value="a">
          <AccordionTrigger>Item A</AccordionTrigger>
          <AccordionContent>Content A</AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>Item B</AccordionTrigger>
          <AccordionContent>Content B</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    await user.click(screen.getByText("Item B"));
    expect(screen.queryByText("Content A")).not.toBeInTheDocument();
    expect(screen.getByText("Content B").closest('[data-state]')).toHaveAttribute(
      "data-state",
      "open",
    );
  });

  it("allows multiple items open at once in multiple mode", async () => {
    const user = userEvent.setup();
    render(
      <Accordion type="multiple">
        <AccordionItem value="a">
          <AccordionTrigger>Item A</AccordionTrigger>
          <AccordionContent>Content A</AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>Item B</AccordionTrigger>
          <AccordionContent>Content B</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    await user.click(screen.getByText("Item A"));
    await user.click(screen.getByText("Item B"));
    expect(screen.getByText("Content A").closest('[data-state]')).toHaveAttribute(
      "data-state",
      "open",
    );
    expect(screen.getByText("Content B").closest('[data-state]')).toHaveAttribute(
      "data-state",
      "open",
    );
  });
});
