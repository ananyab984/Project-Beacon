import { createFileRoute, Outlet } from "@tanstack/react-router";
import { LayoutGrid, ContactRound, Building2, Mail, MessagesSquare, LineChart, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell, type NavItem } from "@/components/features/app-shell";
import { RoleGuard } from "@/components/features/role-guard";
import { AddLeadDialog } from "@/components/features/add-lead-dialog";
import { RecruiterNotificationsPopover } from "@/components/features/recruiter-notifications-popover";

export const Route = createFileRoute("/recruiter")({
  component: () => (
    <RoleGuard role="recruiter">
      <RecruiterLayout />
    </RoleGuard>
  ),
});

const nav: NavItem[] = [
  { to: "/recruiter", label: "Dashboard", icon: LayoutGrid },
  { to: "/recruiter/clients", label: "Clients & Market", icon: Building2 },
  { to: "/recruiter/leads", label: "Leads", icon: ContactRound },
  { to: "/recruiter/email-queue", label: "Email Queue", icon: Mail },
  { to: "/recruiter/conversations", label: "Conversations", icon: MessagesSquare },
  { to: "/recruiter/performance", label: "Recruiter Performance", icon: LineChart },
];

function RecruiterLayout() {
  return (
    <AppShell
      homePath="/recruiter"
      subtitle="Elite Technical Search"
      nav={nav}
      userFallback={{ name: "Recruiter", initial: "R" }}
      headerActions={
        <>
          <RecruiterNotificationsPopover />
          <AddLeadDialog
            trigger={
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm">
                <Plus className="h-3.5 w-3.5" /> Add a Lead
              </Button>
            }
          />
        </>
      }
    >
      <Outlet />
    </AppShell>
  );
}
