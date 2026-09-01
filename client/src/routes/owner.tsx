import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { LayoutGrid, Building2, Users, ContactRound, HelpCircle, Settings, Sparkles, BarChart3, Plus, Mail, MessagesSquare, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell, type NavItem } from "@/components/features/app-shell";
import { EscalationsBell } from "@/components/features/escalations";
import { ClientDemandDialog, openClientDemand } from "@/components/features/client-demand-dialog";
import { GlobalSearchDialog } from "@/components/features/global-search-dialog";
import { RoleGuard } from "@/components/features/role-guard";
import { ConnectAccountDialog } from "@/components/features/connect-account-dialog";
import { useAiFeature } from "@/lib/feature-flags";

export const Route = createFileRoute("/owner")({
  component: OwnerRoot,
});

function OwnerRoot() {
  return (
    <RoleGuard role="owner">
      <OwnerLayout />
    </RoleGuard>
  );
}

function useNav(): NavItem[] {
  const [ai] = useAiFeature();
  return [
    { to: "/owner", label: "Overview", icon: LayoutGrid },
    { to: "/owner/clients", label: "Clients & Market", icon: Building2 },
    { to: "/owner/recruiters", label: "Recruiters", icon: Users },
    { to: "/owner/leads", label: "Leads", icon: ContactRound },
    { to: "/owner/email-queue", label: "Email Queue", icon: Mail },
    { to: "/owner/conversations", label: "Conversations", icon: MessagesSquare },
    { to: "/owner/faqs", label: "FAQs", icon: HelpCircle },
    ...(ai ? [{ to: "/owner/pipelines", label: "AI Pipelines", icon: Sparkles }] : []),
    { to: "/owner/reports", label: "Reports", icon: BarChart3 },
    { to: "/owner/settings", label: "Settings", icon: Settings },
  ];
}

function OwnerLayout() {
  const nav = useNav();
  const [connectOpen, setConnectOpen] = useState(false);

  return (
    <AppShell
      homePath="/owner"
      subtitle="Owner Console"
      nav={nav}
      logoClassName="[&_span]:text-sidebar-primary-foreground"
      userFallback={{ name: "Owner", initial: "O", roleSuffix: " · monitoring" }}
      headerActions={
        <>
          <GlobalSearchDialog />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConnectOpen(true)}
            className="text-xs font-medium gap-1.5 border-border"
          >
            <Link2 className="h-3.5 w-3.5 text-primary" /> Connect Accounts
          </Button>
          <Button
            size="sm"
            onClick={openClientDemand}
            className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" /> Client Demand
          </Button>
          <EscalationsBell />
        </>
      }
      afterContent={
        <>
          <ClientDemandDialog />
          <ConnectAccountDialog open={connectOpen} onOpenChange={setConnectOpen} />
        </>
      }
    >
      <Outlet />
    </AppShell>
  );
}
