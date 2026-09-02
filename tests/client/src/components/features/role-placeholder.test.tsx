import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseAuth, mockNavigate } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ useAuth: mockUseAuth }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

import { RolePlaceholder } from "@/components/features/role-placeholder";

beforeEach(() => {
  mockUseAuth.mockReset();
  mockNavigate.mockClear();
  mockUseAuth.mockReturnValue({ user: { name: "Jane Owner" }, signOut: vi.fn().mockResolvedValue(undefined) });
});

describe("RolePlaceholder", () => {
  it("renders title, description and role caption", () => {
    render(<RolePlaceholder role="Owner" title="Coming soon" description="This section is under construction." />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByText("This section is under construction.")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
  });

  it("renders the current user's name from auth", () => {
    render(<RolePlaceholder role="Owner" title="t" description="d" />);
    expect(screen.getByText("Jane Owner")).toBeInTheDocument();
  });

  it("renders the 'what's coming' bullet list", () => {
    render(<RolePlaceholder role="Owner" title="t" description="d" />);
    expect(screen.getByText("What's coming")).toBeInTheDocument();
    expect(screen.getByText(/Role-specific dashboard/)).toBeInTheDocument();
  });

  it("signs out and navigates to /login on sign-out click", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ user: { name: "Jane Owner" }, signOut });
    const user = userEvent.setup();
    render(<RolePlaceholder role="Owner" title="t" description="d" />);
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });
});
