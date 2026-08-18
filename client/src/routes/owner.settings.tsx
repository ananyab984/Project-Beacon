import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { ConnectAccountDialog } from "@/components/features/connect-account-dialog";
import { Linkedin, Mail, Trash2, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/owner/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Global3" },
      { name: "description", content: "Owner settings: AI tools, roles, integrations, exports, audit trail." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [showAI, setShowAI] = useState(false);
  const { data } = useQuery({
    queryKey: ["users", "RECRUITER"],
    queryFn: () => api.getUsers("RECRUITER"),
    staleTime: 5_000,
    refetchInterval: 8_000,
  });
  const recruiters = data?.users ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Section
        title="AI tools"
        desc="AI metrics and pipeline tools are hidden by default so day-to-day oversight stays focused on recruiter, lead and language signals."
      >
        <Row
          title="Show AI tools"
          desc="Reveals LinkedIn match confidence, reply-to-classification accuracy, and the AI Pipeline management section below."
        >
          <Switch checked={showAI} onCheckedChange={setShowAI} />
        </Row>
      </Section>

      {showAI && (
        <Section
          title="AI Pipeline management"
          desc="Under review — surface with beta styling; not for day-to-day decisions."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <BetaCard
              title="LinkedIn match confidence"
              body="Identity-resolution confidence score for ambiguous records. Example: masked lead #H-7724 at 0.55 confidence."
            />
            <BetaCard
              title="Reply-to-classification accuracy"
              body="Agreement between AI's read on a reply and recruiter conclusion. Sampled on Madhu's queue — 62%."
            />
            <DeferredCard title="AI-draft edit rate" />
            <DeferredCard title="Time-to-first-reply by language / channel" />
            <DeferredCard title="Data health trend — shrinking unresolved-identity records" />
          </div>
        </Section>
      )}

      <ConnectedAccountsSection />

      <Section title="Recruiters & Connected Outreach Accounts Mapping" desc="Live mapping of recruiters and their connected LinkedIn & Email Unipile accounts.">
        <div className="divide-y divide-border">
          {recruiters.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No team members onboarded yet.
            </div>
          ) : (
            recruiters.map((u: any) => {
              const activeAccs = (u.connectedAccounts || []).filter((a: any) => a.status !== "DISCONNECTED");
              const linkedInAcc = activeAccs.find((a: any) => (a.provider || "").toUpperCase().includes("LINKEDIN"));
              const emailAcc = activeAccs.find((a: any) => ["EMAIL", "GOOGLE", "MAIL", "OUTLOOK"].some((p) => (a.provider || "").toUpperCase().includes(p)));

              return (
                <div key={u.id} className="py-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-sm text-foreground">{u.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">({u.email})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {u.workStatus === "CONTRACTOR" ? "Contractor Recruiter" : "Full-Access Recruiter"}
                      </Badge>
                      <Badge variant={u.isActive ? "default" : "secondary"} className="text-[10px]">
                        {u.isActive ? "Active" : "Deactivated"}
                      </Badge>
                    </div>
                  </div>

                  {/* Connected Accounts Mapping for this recruiter */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Linkedin className="h-4 w-4 text-blue-500 shrink-0" />
                        <span className="font-medium text-foreground">LinkedIn:</span>
                        <span className="text-muted-foreground truncate max-w-[160px]">
                          {linkedInAcc ? (linkedInAcc.accountName || linkedInAcc.unipileAccountId) : "Not Connected"}
                        </span>
                      </div>
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${linkedInAcc ? "border-emerald-500/40 text-emerald-500" : "text-muted-foreground"}`}>
                        {linkedInAcc ? "CONNECTED" : "UNLINKED"}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-amber-500 shrink-0" />
                        <span className="font-medium text-foreground">Email:</span>
                        <span className="text-muted-foreground truncate max-w-[160px]">
                          {emailAcc ? (emailAcc.accountName || emailAcc.unipileAccountId) : "Not Connected"}
                        </span>
                      </div>
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${emailAcc ? "border-emerald-500/40 text-emerald-500" : "text-muted-foreground"}`}>
                        {emailAcc ? "CONNECTED" : "UNLINKED"}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Section>

      <Section title="Audit trail" desc="Latest system events. Retained indefinitely per data retention policy.">
        <div className="rounded-lg border border-border">
          <div className="py-6 text-center text-xs text-muted-foreground">
            No system events logged yet.
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h3 className="text-base font-semibold">{title}</h3>
      {desc && <p className="mt-1 text-xs text-muted-foreground">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="mt-0.5 text-xs text-muted-foreground max-w-lg">{desc}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function BetaCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">{title}</div>
        <Badge variant="outline" className="border-warning/50 text-warning text-[10px]">
          Under review
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

function DeferredCard({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4 opacity-70">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">{title}</div>
        <Badge variant="outline" className="text-[10px]">
          Coming soon
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Widget disabled until validation.</p>
    </div>
  );
}

function ConnectedAccountsSection() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["connected-accounts"],
    queryFn: () => api.getConnectedAccounts(),
    staleTime: 5_000,
    refetchInterval: 8_000,
  });

  const disconnectMutation = useMutation({
    mutationFn: (unipileAccountId: string) => api.disconnectAccount(unipileAccountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["users", "RECRUITER"] });
      toast.success("Account disconnected");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to disconnect account"),
  });

  const active = accounts.filter((a: any) => a.status !== "DISCONNECTED");

  return (
    <Section title="Connected Outreach Accounts" desc="Manage active LinkedIn and Email accounts linked via Unipile.">
      <div className="space-y-4">
        {active.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No outreach accounts connected yet. Link LinkedIn or Email to enable messaging.
          </div>
        ) : (
          <div className="space-y-2">
            {active.map((acc: any) => (
              <div key={acc.id || acc.unipileAccountId} className="flex items-center justify-between rounded-xl border border-border bg-card p-3 shadow-xs">
                <div className="flex items-center gap-3">
                  {acc.provider === "LINKEDIN" ? (
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                      <Linkedin className="h-4 w-4" />
                    </div>
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                      <Mail className="h-4 w-4" />
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-semibold text-foreground">
                      {acc.accountName || acc.unipileAccountId}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-emerald-500/40 text-emerald-500">
                        {acc.status || "CONNECTED"}
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

        <div className="flex justify-end">
          <ConnectAccountDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            trigger={
              <Button size="sm" variant="outline" className="text-xs gap-1.5">
                <Plus className="h-3.5 w-3.5 text-primary" /> Connect New Account
              </Button>
            }
          />
        </div>
      </div>
    </Section>
  );
}
