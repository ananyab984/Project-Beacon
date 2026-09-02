import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Progress } from "@/components/ui/progress";

describe("Progress", () => {
  it("translates the indicator based on value", () => {
    const { container } = render(<Progress value={30} />);
    const indicator = container.querySelector('[class*="flex-1"]') as HTMLElement;
    expect(indicator.style.transform).toBe("translateX(-70%)");
  });

  it("defaults to 0 when value is undefined", () => {
    const { container } = render(<Progress />);
    const indicator = container.querySelector('[class*="flex-1"]') as HTMLElement;
    expect(indicator.style.transform).toBe("translateX(-100%)");
  });
});
