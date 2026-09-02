import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseAuth, mockUseNavigate, mockNavigate, mockUseRouterState } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseNavigate: vi.fn(),
  mockNavigate: vi.fn(),
  mockUseRouterState: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ useAuth: mockUseAuth }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={typeof to === "string" ? to : "#"} {...props}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
  useNavigate: () => {
    mockUseNavigate();
    return mockNavigate;
  },
  useRouterState: (opts: any) => mockUseRouterState(opts),
}));

import { AppShell, type NavItem } from "@/components/features/app-shell";

function Icon(props: { className?: string }) {
  return <svg data-testid="nav-icon" className={props.className} />;
}

const nav: NavItem[] = [
  { to: "/owner", label: "Dashboard", icon: Icon },
  { to: "/owner/leads", label: "Leads", icon: Icon },
];

beforeEach(() => {
  mockUseAuth.mockReset();
  mockUseNavigate.mockClear();
  mockNavigate.mockClear();
  mockUseRouterState.mockReset();
  mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn().mockResolvedValue(undefined) });
  mockUseRouterState.mockImplementation(({ select }: any) => select({ location: { pathname: "/owner" } }));
});

describe("AppShell", () => {
  it("renders nav items and highlights the exact home path as active", () => {
    render(
      <AppShell homePath="/owner" subtitle="Owner console" nav={nav} userFallback={{ name: "Owner", initial: "O" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveClass("bg-sidebar-accent");
    expect(screen.getByRole("link", { name: /Leads/ })).not.toHaveClass("bg-sidebar-accent");
  });

  it("highlights a nested route via startsWith", () => {
    mockUseRouterState.mockImplementation(({ select }: any) => select({ location: { pathname: "/owner/leads/42" } }));
    render(
      <AppShell homePath="/owner" subtitle="Owner console" nav={nav} userFallback={{ name: "Owner", initial: "O" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: /Leads/ })).toHaveClass("bg-sidebar-accent");
  });

  it("sets the header title from the active nav item, falling back to nav[0]", () => {
    mockUseRouterState.mockImplementation(({ select }: any) => select({ location: { pathname: "/owner/unmatched" } }));
    render(
      <AppShell homePath="/owner" subtitle="Owner console" nav={nav} userFallback={{ name: "Owner", initial: "O" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("renders children instead of Outlet when children is provided", () => {
    render(
      <AppShell homePath="/owner" subtitle="Owner console" nav={nav} userFallback={{ name: "Owner", initial: "O" }}>
        <div>my content</div>
      </AppShell>,
    );
    expect(screen.getByText("my content")).toBeInTheDocument();
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });

  it("renders Outlet when children is null", () => {
    render(
      <AppShell homePath="/owner" subtitle="Owner console" nav={nav} userFallback={{ name: "Owner", initial: "O" }}>
        {null}
      </AppShell>,
    );
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  it("shows userFallback name/initial when no user is signed in yet", () => {
    render(
      <AppShell homePath="/owner" subtitle="Owner console" nav={nav} userFallback={{ name: "Owner", initial: "O" }}>
        <div />
      </AppShell>,
    );
    expect(screen.getByText("O")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
  });

  it("shows the real user's name/initial/role when signed in", () => {
    mockUseAuth.mockReturnValue({
      user: { name: "Jane Recruiter", role: "recruiter", email: "jane@g3.com" },
      signOut: vi.fn().mockResolvedValue(undefined),
    });
    render(
      <AppShell homePath="/owner" subtitle="Owner console" nav={nav} userFallback={{ name: "Owner", initial: "O" }}>
        <div />
      </AppShell>,
    );
    expect(screen.getByText("Jane Recruiter")).toBeInTheDocument();
    expect(screen.getByText("J")).toBeInTheDocument();
    expect(screen.getByText("recruiter")).toBeInTheDocument();
  });

  it("appends roleSuffix next to the role/name fallback", () => {
    render(
      <AppShell
        homePath="/owner"
        subtitle="Owner console"
        nav={nav}
        userFallback={{ name: "Owner", initial: "O", roleSuffix: " (fallback)" }}
      >
        <div />
      </AppShell>,
    );
    expect(screen.getByText(/\(fallback\)/)).toBeInTheDocument();
  });

  it("renders headerActions when provided, omits the wrapper when not", () => {
    const { rerender } = render(
      <AppShell homePath="/owner" subtitle="Owner console" nav={nav} userFallback={{ name: "Owner", initial: "O" }}>
        <div />
      </AppShell>,
    );
    expect(screen.queryByTestId("header-actions")).not.toBeInTheDocument();

    rerender(
      <AppShell
        homePath="/owner"
        subtitle="Owner console"
        nav={nav}
        userFallback={{ name: "Owner", initial: "O" }}
        headerActions={<button data-testid="header-actions">Add lead</button>}
      >
        <div />
      </AppShell>,
    );
    expect(screen.getByTestId("header-actions")).toBeInTheDocument();
  });

  it("renders afterContent after the main content", () => {
    render(
      <AppShell
        homePath="/owner"
        subtitle="Owner console"
        nav={nav}
        userFallback={{ name: "Owner", initial: "O" }}
        afterContent={<div>after content marker</div>}
      >
        <div />
      </AppShell>,
    );
    expect(screen.getByText("after content marker")).toBeInTheDocument();
  });

  it("forwards logoClassName to the logo", () => {
    const { container } = render(
      <AppShell
        homePath="/owner"
        subtitle="Owner console"
        nav={nav}
        userFallback={{ name: "Owner", initial: "O" }}
        logoClassName="owner-tint"
      >
        <div />
      </AppShell>,
    );
    expect(container.querySelector(".owner-tint")).toBeInTheDocument();
  });

  it("signs out and navigates to /login when 'Sign out' is clicked", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ user: { name: "Jane", role: "owner" }, signOut });
    const user = userEvent.setup();
    render(
      <AppShell homePath="/owner" subtitle="Owner console" nav={nav} userFallback={{ name: "Owner", initial: "O" }}>
        <div />
      </AppShell>,
    );
    await user.click(screen.getByText("Jane"));
    await user.click(await screen.findByText("Sign out"));
    expect(signOut).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });
});
