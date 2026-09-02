import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // embla-carousel evaluates responsive breakpoints via matchMedia, which jsdom lacks.
  window.matchMedia =
    window.matchMedia ||
    ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  if (!("IntersectionObserver" in globalThis)) {
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function Basic() {
  return (
    <Carousel>
      <CarouselContent>
        <CarouselItem>Slide 1</CarouselItem>
        <CarouselItem>Slide 2</CarouselItem>
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  );
}

describe("Carousel", () => {
  it("renders slides and a carousel region", () => {
    render(<Basic />);
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("aria-roledescription", "carousel");
    expect(screen.getByText("Slide 1")).toBeInTheDocument();
    expect(screen.getByText("Slide 2")).toBeInTheDocument();
  });

  it("gives each slide a group role with slide roledescription", () => {
    render(<Basic />);
    const slides = screen.getAllByRole("group");
    expect(slides).toHaveLength(2);
    slides.forEach((slide) => expect(slide).toHaveAttribute("aria-roledescription", "slide"));
  });

  it("clicking Previous/Next does not throw (embla initialized on a single slide viewport in jsdom)", async () => {
    const user = userEvent.setup();
    render(<Basic />);
    await expect(user.click(screen.getByText("Previous slide"))).resolves.not.toThrow();
    await expect(user.click(screen.getByText("Next slide"))).resolves.not.toThrow();
  });

  it("throws when a sub-component is rendered outside <Carousel>", () => {
    expect(() => render(<CarouselContent />)).toThrow("useCarousel must be used within a <Carousel />");
  });

  it("Previous button is disabled at the start (jsdom has no real scroll snap, so canScrollPrev stays false)", () => {
    render(<Basic />);
    expect(screen.getByText("Previous slide").closest("button")).toBeDisabled();
  });
});
