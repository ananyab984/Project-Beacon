import { createFileRoute, Outlet } from "@tanstack/react-router";
import { LayoutGrid, ContactRound, Mail, MessagesSquare, LineChart, Settings as SettingsIcon, Plus, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell, type NavItem } from "@/components/features/app-shell";
import { RoleGuard } from "@/components/features/role-guard";
import { ContractorAddLeadDialog } from "@/components/features/contractor-add-lead-dialog";

export const Route = createFileRoute("/contractor")({
  component: () => (
    <RoleGuard role="contractor">
      <ContractorLayout />
    </RoleGuard>
  ),
});

const nav: NavItem[] = [
  { to: "/contractor", label: "Dashboard", icon: LayoutGrid },
  { to: "/contractor/leads", label: "My Leads", icon: ContactRound },
  { to: "/contractor/requirements", label: "Requirements", icon: ClipboardList },
  { to: "/contractor/email-queue", label: "Email Queue", icon: Mail },
  { to: "/contractor/conversations", label: "Conversations", icon: MessagesSquare },
  { to: "/contractor/performance", label: "Lead Performance", icon: LineChart },
  { to: "/contractor/settings", label: "Settings", icon: SettingsIcon },
];

function ContractorLayout() {
  return (
    <AppShell
      homePath="/contractor"
      subtitle="Elite Technical Search"
      nav={nav}
      userFallback={{ name: "Contractor", initial: "C" }}
      headerActions={
        <ContractorAddLeadDialog
          trigger={
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm">
              <Plus className="h-3.5 w-3.5" /> Add a Lead
            </Button>
          }
        />
      }
    >
      <Outlet />
    </AppShell>
  );
}
