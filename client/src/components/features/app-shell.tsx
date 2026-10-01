import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { G3Logo } from "@/components/features/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";

export type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

type AppShellProps = {
  /** Base path of this role's section, e.g. "/owner" — used to resolve the active nav item. */
  homePath: string;
  /** Small uppercase caption under the logo. */
  subtitle: string;
  nav: NavItem[];
  /** Fallbacks shown before the auth user has hydrated. */
  userFallback: { name: string; initial: string; roleSuffix?: string };
  /** Optional className forwarded to the logo (owner tints it differently). */
  logoClassName?: string;
  /** Right-aligned controls in the top header (add-lead button, bells, etc.). */
  headerActions?: ReactNode;
  /** Rendered after the main content — used for globally-mounted dialogs. */
  afterContent?: ReactNode;
  children: ReactNode;
};

/** True when `path` is within the `home` section (exact match for the section root). */
function isActive(path: string, to: string, home: string): boolean {
  if (to === home) return path === home || path === `${home}/`;
  return path.startsWith(to);
}

/**
 * Sidebar + top-header frame shared by the owner, recruiter, and contractor
 * consoles. Each role supplies only its nav, subtitle, and header actions.
 */
export function AppShell({
  homePath,
  subtitle,
  nav,
  userFallback,
  logoClassName,
  headerActions,
  afterContent,
  children,
}: AppShellProps) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const current = nav.find((item) => isActive(path, item.to, homePath));

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
    >
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="px-5 pb-4 pt-5">
          <G3Logo className={logoClassName} />
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground">
            {subtitle}
          </div>
        </div>

        <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
          {nav.map((item) => {
            const active = isActive(path, item.to, homePath);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_var(--sidebar-border)] before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r before:bg-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${
                    active
                      ? "text-primary"
                      : "text-sidebar-foreground group-hover:text-sidebar-accent-foreground"
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="mx-3 mb-4 flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent p-3 text-left transition-colors hover:border-primary/60 hover:bg-sidebar-accent/90">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                {(user?.name ?? userFallback.initial).slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-sidebar-primary-foreground">
                  {user?.name ?? userFallback.name}
                </div>
                <div className="truncate text-[11px] font-medium text-sidebar-foreground capitalize">
                  {user?.role ?? userFallback.name.toLowerCase()}
                  {userFallback.roleSuffix}
                </div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {user?.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                signOut();
                navigate({ to: "/login", replace: true });
              }}
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </aside>

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/80 px-6 backdrop-blur">
          <h1 className="text-[15px] font-semibold tracking-tight">
            {current?.label ?? nav[0]?.label}
          </h1>
          {headerActions ? (
            <div className="flex items-center gap-2">{headerActions}</div>
          ) : null}
        </header>

        <main className="px-6 py-6">
          {children ?? <Outlet />}
        </main>
        {afterContent}
      </div>
    </div>
  );
}
