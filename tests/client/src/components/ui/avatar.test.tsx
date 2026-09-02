import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

describe("Avatar", () => {
  it("renders the fallback since images never finish loading in jsdom", () => {
    render(
      <Avatar>
        <AvatarImage src="https://example.com/avatar.png" alt="User" />
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText("AB")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("merges custom className on root", () => {
    const { container } = render(<Avatar className="my-class" />);
    expect(container.firstChild).toHaveClass("my-class");
    expect(container.firstChild).toHaveClass("rounded-full");
  });

  it("forwards className on fallback", () => {
    render(
      <Avatar>
        <AvatarFallback className="fallback-class">AB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText("AB")).toHaveClass("fallback-class");
  });
});
