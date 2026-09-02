import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function ExampleTabs() {
  return (
    <Tabs defaultValue="one">
      <TabsList>
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
      <TabsContent value="one">Content One</TabsContent>
      <TabsContent value="two">Content Two</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("shows the defaultValue tab's content initially", () => {
    render(<ExampleTabs />);
    expect(screen.getByText("Content One")).toBeInTheDocument();
    expect(screen.queryByText("Content Two")).not.toBeInTheDocument();
  });

  it("switches content when a different trigger is clicked", async () => {
    const user = userEvent.setup();
    render(<ExampleTabs />);
    await user.click(screen.getByText("Two"));
    expect(screen.getByText("Content Two")).toBeInTheDocument();
    expect(screen.queryByText("Content One")).not.toBeInTheDocument();
  });

  it("marks the active trigger with data-state=active", async () => {
    const user = userEvent.setup();
    render(<ExampleTabs />);
    const one = screen.getByText("One");
    const two = screen.getByText("Two");
    expect(one).toHaveAttribute("data-state", "active");
    expect(two).toHaveAttribute("data-state", "inactive");
    await user.click(two);
    expect(one).toHaveAttribute("data-state", "inactive");
    expect(two).toHaveAttribute("data-state", "active");
  });
});
