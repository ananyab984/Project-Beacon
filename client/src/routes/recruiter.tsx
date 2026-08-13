import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { LayoutGrid, ContactRound, Building2, Mail, MessagesSquare, LineChart, Plus, Users, Link2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell, type NavItem } from "@/components/features/app-shell";
import { RoleGuard } from "@/components/features/role-guard";
import { AddLeadDialog } from "@/components/features/add-lead-dialog";
import { ConnectAccountDialog } from "@/components/features/connect-account-dialog";
import { RecruiterNotificationsPopover } from "@/components/features/recruiter-notifications-popover";
import { api } from "@/lib/api";
import { toast } from "sonner";

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
  { to: "/recruiter/contractors", label: "Contractors", icon: Users },
  { to: "/recruiter/email-queue", label: "Email Queue", icon: Mail },
  { to: "/recruiter/conversations", label: "Conversations", icon: MessagesSquare },
  { to: "/recruiter/performance", label: "Recruiter Performance", icon: LineChart },
  { to: "/recruiter/settings", label: "Settings", icon: Settings },
];

function RecruiterLayout() {
  const [connectOpen, setConnectOpen] = useState(false);

  useEffect(() => {
    // 1. Check URL parameters for returning Unipile redirect
    const urlParams = new URLSearchParams(window.location.search);
    const status = urlParams.get("status");
    const provider = urlParams.get("provider");

    if (status === "connected") {
      const pName = provider === "EMAIL" ? "Email" : provider === "LINKEDIN" ? "LinkedIn" : "Outreach account";
      toast.success(`${pName} connected successfully!`);

      // If running inside a popup window, notify parent window and close popup
      if (window.opener) {
        try {
          window.opener.postMessage({ type: "UNIPILE_CONNECTED", provider }, "*");
          window.close();
        } catch {}
      }

      // Clean query params from URL
      window.history.replaceState({}, document.title, window.location.pathname);
      setConnectOpen(false);
    }

    // 2. Check if user has connected accounts; if none, auto-open setup popup on dashboard land
    api.getConnectedAccounts().then((accs) => {
      const active = accs.filter((a: any) => a.status !== "DISCONNECTED");
      if (active.length === 0 && !status) {
        setConnectOpen(true);
      } else {
        setConnectOpen(false);
      }
    }).catch(() => {});

    // 3. Listen for postMessage from popup window if connected in child popup
    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === "UNIPILE_CONNECTED") {
        toast.success("Account connected successfully!");
        setConnectOpen(false);
      }
    };
    window.addEventListener("message", messageHandler);
    return () => window.removeEventListener("message", messageHandler);
  }, []);

  return (
    <AppShell
      homePath="/recruiter"
      subtitle="Elite Technical Search"
      nav={nav}
      userFallback={{ name: "Recruiter", initial: "R" }}
      headerActions={
        <>
          <RecruiterNotificationsPopover />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConnectOpen(true)}
            className="text-xs font-medium gap-1.5 border-border"
          >
            <Link2 className="h-3.5 w-3.5 text-primary" /> Connect Accounts
          </Button>
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
      <ConnectAccountDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </AppShell>
  );
}
