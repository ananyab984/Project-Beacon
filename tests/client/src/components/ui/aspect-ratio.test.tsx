import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AspectRatio } from "@/components/ui/aspect-ratio";

describe("AspectRatio", () => {
  it("renders children within a ratio container", () => {
    render(
      <AspectRatio ratio={16 / 9}>
        <img src="/x.png" alt="test" />
      </AspectRatio>,
    );
    expect(screen.getByAltText("test")).toBeInTheDocument();
  });
});
