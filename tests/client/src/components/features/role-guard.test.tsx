import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockUseAuth, mockUseRouterState, mockNavigateSpy } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseRouterState: vi.fn(),
  mockNavigateSpy: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ useAuth: mockUseAuth }));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: mockUseRouterState,
  Navigate: (props: any) => {
    mockNavigateSpy(props);
    return <div data-testid="navigate" data-to={props.to} data-search={JSON.stringify(props.search ?? null)} />;
  },
}));

import { RoleGuard } from "@/components/features/role-guard";

beforeEach(() => {
  mockUseAuth.mockReset();
  mockUseRouterState.mockReset();
  mockNavigateSpy.mockClear();
  mockUseRouterState.mockImplementation(({ select }: any) => select({ location: { pathname: "/owner/leads" } }));
});

describe("RoleGuard", () => {
  it("shows a loading state while auth is hydrating", () => {
    mockUseAuth.mockReturnValue({ user: null, isHydrating: true });
    render(
      <RoleGuard role="owner">
        <div>secret</div>
      </RoleGuard>,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("redirects to /login with the current path when there is no user", () => {
    mockUseAuth.mockReturnValue({ user: null, isHydrating: false });
    render(
      <RoleGuard role="owner">
        <div>secret</div>
      </RoleGuard>,
    );
    const nav = screen.getByTestId("navigate");
    expect(nav).toHaveAttribute("data-to", "/login");
    expect(nav).toHaveAttribute("data-search", JSON.stringify({ redirect: "/owner/leads" }));
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("redirects to /unauthorized when the user's role doesn't match", () => {
    mockUseAuth.mockReturnValue({ user: { role: "recruiter" }, isHydrating: false });
    render(
      <RoleGuard role="owner">
        <div>secret</div>
      </RoleGuard>,
    );
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", "/unauthorized");
  });

  it("matches roles case-insensitively", () => {
    mockUseAuth.mockReturnValue({ user: { role: "OWNER" }, isHydrating: false });
    render(
      <RoleGuard role="owner">
        <div>secret</div>
      </RoleGuard>,
    );
    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });

  it("renders children when the role matches exactly", () => {
    mockUseAuth.mockReturnValue({ user: { role: "recruiter" }, isHydrating: false });
    render(
      <RoleGuard role="recruiter">
        <div>secret</div>
      </RoleGuard>,
    );
    expect(screen.getByText("secret")).toBeInTheDocument();
  });
});
