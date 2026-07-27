import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { G3Logo } from "@/components/g3/logo";
import { LayoutGrid, ContactRound, Mail, MessagesSquare, LineChart, Settings as SettingsIcon, Plus, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RoleGuard } from "@/components/g3/role-guard";
import { useAuth } from "@/lib/auth";
import { ContractorAddLeadDialog } from "@/components/g3/contractor-add-lead-dialog";
import type { ComponentType } from "react";

export const Route = createFileRoute("/contractor")({
  component: () => (
    <RoleGuard role="contractor">
      <ContractorLayout />
    </RoleGuard>
  ),
});

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }> };

const nav: NavItem[] = [
  { to: "/contractor", label: "Dashboard", icon: LayoutGrid },
  { to: "/contractor/leads", label: "My Leads", icon: ContactRound },
  { to: "/contractor/email-queue", label: "Email Queue", icon: Mail },
  { to: "/contractor/conversations", label: "Conversations", icon: MessagesSquare },
  { to: "/contractor/performance", label: "Lead Performance", icon: LineChart },
  { to: "/contractor/settings", label: "Settings", icon: SettingsIcon },
];

function ContractorLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = nav.find((n) => (n.to === "/contractor" ? path === "/contractor" || path === "/contractor/" : path.startsWith(n.to)));
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="px-5 pb-4 pt-5">
          <G3Logo />
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground">
            Elite Technical Search
          </div>
        </div>

        <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
          {nav.map((item) => {
            const isActive = item.to === "/contractor" ? path === "/contractor" || path === "/contractor/" : path.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_var(--sidebar-border)] before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r before:bg-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? "text-primary" : "text-sidebar-foreground group-hover:text-sidebar-accent-foreground"}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="mx-3 my-3 flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent p-3 text-left transition-colors hover:border-primary/60 hover:bg-sidebar-accent/90">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                {(user?.name ?? "C").slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-sidebar-primary-foreground">{user?.name ?? "Contractor"}</div>
                <div className="truncate text-[11px] font-medium text-sidebar-foreground capitalize">{user?.role ?? "contractor"}</div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { signOut(); navigate({ to: "/login", replace: true }); }}>
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </aside>

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/80 px-6 backdrop-blur">
          <h1 className="text-[15px] font-semibold tracking-tight">{current?.label ?? "Dashboard"}</h1>
          <div className="flex items-center gap-2">
            <ContractorAddLeadDialog
              trigger={
                <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm">
                  <Plus className="h-3.5 w-3.5" /> Add a Lead
                </Button>
              }
            />
          </div>
        </header>

        <main className="px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}