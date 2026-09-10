import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, ContactRound, Mail, MessagesSquare, LineChart, Settings as SettingsIcon, Plus, ClipboardList, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell, type NavItem } from "@/components/features/app-shell";
import { RoleGuard } from "@/components/features/role-guard";
import { ContractorAddLeadDialog } from "@/components/features/contractor-add-lead-dialog";
import { ConnectAccountDialog } from "@/components/features/connect-account-dialog";
import { toast } from "sonner";

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
  const queryClient = useQueryClient();
  const [connectOpen, setConnectOpen] = useState(false);

  // Same Unipile OAuth-popup handling as recruiter.tsx -- Connect Accounts
  // uses a role-agnostic dialog/backend (no requireRole gate on the Unipile
  // routes at all), so this parity is purely wiring, not a permission change.
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const status = urlParams.get("status");
    const provider = urlParams.get("provider");

    if (status === "connected") {
      const pName = provider === "EMAIL" ? "Email" : provider === "LINKEDIN" ? "LinkedIn" : "Outreach account";
      toast.success(`${pName} connected successfully!`);
      queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });

      if (window.opener) {
        try {
          window.opener.postMessage({ type: "UNIPILE_CONNECTED", provider }, "*");
          window.close();
        } catch {}
      }

      window.history.replaceState({}, document.title, window.location.pathname);
      setConnectOpen(false);
    }

    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === "UNIPILE_CONNECTED") {
        toast.success("Account connected successfully!");
        queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });
        setConnectOpen(false);
      }
    };
    window.addEventListener("message", messageHandler);
    return () => window.removeEventListener("message", messageHandler);
  }, [queryClient]);

  return (
    <AppShell
      homePath="/contractor"
      subtitle="Elite Technical Search"
      nav={nav}
      userFallback={{ name: "Contractor", initial: "C" }}
      headerActions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConnectOpen(true)}
            className="text-xs font-medium gap-1.5 border-border"
          >
            <Link2 className="h-3.5 w-3.5 text-primary" /> Connect Accounts
          </Button>
          <ContractorAddLeadDialog
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
