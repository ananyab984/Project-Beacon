import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ConnectAccountDialog } from "@/components/features/connect-account-dialog";
import { Linkedin, Mail, Trash2, Plus, ShieldCheck, User, Settings as SettingsIcon, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/recruiter/settings")({
  head: () => ({
    meta: [
      { title: "Recruiter Settings — Global3" },
      { name: "description", content: "Recruiter settings: Outreach accounts, connected IDs, profile preferences." },
    ],
  }),
  component: RecruiterSettingsPage,
});

function RecruiterSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["connected-accounts"],
    queryFn: () => api.getConnectedAccounts(),
  });

  const disconnectMutation = useMutation({
    mutationFn: (unipileAccountId: string) => api.disconnectAccount(unipileAccountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });
      toast.success("Account disconnected successfully");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to disconnect account"),
  });

  const activeAccounts = accounts.filter((a: any) => a.status !== "DISCONNECTED");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Preferences & Integrations</div>
        <h2 className="mt-0.5 text-2xl font-semibold tracking-tight">Recruiter Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your connected LinkedIn and Email outreach accounts, credentials, and profile settings.
        </p>
      </div>

      {/* Connected Accounts Section */}
      <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Connected Outreach Accounts
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Link your LinkedIn or Email via Unipile Hosted Auth to send DMs & tracked emails directly from Global3.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setConnectDialogOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold gap-1.5 shadow-xs"
          >
            <Plus className="h-3.5 w-3.5" /> Connect Account
          </Button>
        </div>

        {activeAccounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground space-y-2">
            <div>No outreach accounts connected yet.</div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConnectDialogOpen(true)}
              className="text-xs mt-2"
            >
              + Connect LinkedIn or Email
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {activeAccounts.map((acc: any) => (
              <div
                key={acc.id || acc.unipileAccountId}
                className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-4 shadow-xs"
              >
                <div className="flex items-center gap-3">
                  {acc.provider === "LINKEDIN" ? (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                      <Linkedin className="h-5 w-5" />
                    </div>
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                      <Mail className="h-5 w-5" />
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {acc.accountName || acc.unipileAccountId}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-500/40 text-emerald-500 font-semibold gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" /> {acc.status || "CONNECTED"}
                      </Badge>
                      <span>• {acc.provider}</span>
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disconnectMutation.isPending}
                  onClick={() => disconnectMutation.mutate(acc.unipileAccountId)}
                  className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive gap-1"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recruiter Profile Details Section */}
      <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <User className="h-5 w-5 text-accent" /> Profile & Credentials
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Full Name</Label>
            <Input value={user?.name || ""} disabled className="bg-muted/30 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Work Email</Label>
            <Input value={user?.email || ""} disabled className="bg-muted/30 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Role</Label>
            <Input value="Recruiter — Candidate Oversight & Sourcing" disabled className="bg-muted/30 text-xs" />
          </div>
        </div>
      </section>

      <ConnectAccountDialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen} />
    </div>
  );
}
