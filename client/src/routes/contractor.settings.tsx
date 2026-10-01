import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { KeyRound, Mail, ShieldCheck, User as UserIcon, Bell } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

export const Route = createFileRoute("/contractor/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Contractor · Global3" },
      { name: "description", content: "Manage your account name and password." },
    ],
  }),
  component: ContractorSettingsPage,
});

function ContractorSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: prefsData } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: api.getNotificationPreferences,
  });

  // One Email toggle and one Slack toggle for everything -- contractors get
  // 5 notification types (enrichment done, lead replies, daily demand
  // summary, weekly leads/performance digests) and per-type rows aren't
  // worth the UI weight recruiter.settings.tsx's table carries for its own
  // 5 types. Each toggle still fans out to every type's own preference row
  // server-side (see the bulk PATCH /preferences route) -- the schema and
  // send-time checks stay per-type, only this page's UI is collapsed.
  const updateAllMutation = useMutation({
    mutationFn: (patch: { emailEnabled?: boolean; slackEnabled?: boolean }) =>
      api.updateAllNotificationPreferences(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-preferences"] }),
    onError: (err: any) => toast.error(err?.message || "Failed to update notification preferences"),
  });

  const [slackMemberId, setSlackMemberId] = useState(user?.slackMemberId ?? "");
  const slackMutation = useMutation({
    mutationFn: () => api.updateSlackMemberId(user!.id, slackMemberId.trim() || null),
    onSuccess: () => toast.success("Slack member ID saved"),
    onError: (err: any) => toast.error(err?.message || "Failed to save Slack member ID"),
  });

  const preferences = prefsData?.preferences ?? [];
  // "On" only once every type actually has that channel enabled -- a mixed
  // state (e.g. one type toggled on some other way) reads as off rather than
  // silently claiming a partial state is fully on.
  const emailOn = preferences.length > 0 && preferences.every((p) => p.emailEnabled);
  const slackOn = preferences.length > 0 && preferences.every((p) => p.slackEnabled);

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-24">
      <section className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 via-accent/5 to-transparent p-6">
        <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Account settings</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">Your account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Recruiters see your submitted leads and sourcing activity — there's no separate
          contractor profile to fill out here.
        </p>
      </section>

      <Section title="Profile" icon={<UserIcon className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground/90">
              <UserIcon className="h-3 w-3" /> Name
            </Label>
            <Input value={user?.name ?? ""} disabled />
          </div>
          <div>
            <Label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground/90">
              <Mail className="h-3 w-3" /> Email
            </Label>
            <Input value={user?.email ?? ""} disabled />
          </div>
        </div>
        <div className="mt-4">
          <Badge variant="outline" className="text-[10px]">Role: Contractor</Badge>
        </div>
      </Section>

      <Section title="Notification Preferences" icon={<Bell className="h-3.5 w-3.5" />}>
        <p className="text-xs text-muted-foreground">
          The in-app bell is always on -- for enrichment finishing on a lead you added, a lead
          replying, a daily summary of open demand headcount, and weekly summaries of the leads
          you've added and your performance. Turn on email or Slack below to get those the same
          way.
        </p>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
            <div>
              <div className="text-xs font-semibold text-foreground">Email notifications</div>
              <div className="text-[11px] text-muted-foreground">Send all of the above to your work email too.</div>
            </div>
            <Switch
              checked={emailOn}
              disabled={updateAllMutation.isPending}
              onCheckedChange={(checked) => updateAllMutation.mutate({ emailEnabled: checked })}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
            <div>
              <div className="text-xs font-semibold text-foreground">Slack notifications</div>
              <div className="text-[11px] text-muted-foreground">
                Send all of the above as a Slack DM too (needs your Slack Member ID below).
              </div>
            </div>
            <Switch
              checked={slackOn}
              disabled={updateAllMutation.isPending}
              onCheckedChange={(checked) => updateAllMutation.mutate({ slackEnabled: checked })}
            />
          </div>
        </div>

        <div className="mt-4 space-y-1.5 border-t border-border pt-4">
          <Label className="text-xs">Slack Member ID</Label>
          <p className="text-[11px] text-muted-foreground">
            Copy your member ID from your Slack profile and paste it here to receive Slack
            notifications.
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={slackMemberId}
              onChange={(e) => setSlackMemberId(e.target.value)}
              placeholder="U0XXXXXXX"
              className="text-xs max-w-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={slackMutation.isPending}
              onClick={() => slackMutation.mutate()}
              className="text-xs"
            >
              Save
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Security" icon={<ShieldCheck className="h-3.5 w-3.5" />}>
        <ChangePasswordForm />
      </Section>
    </div>
  );
}

function ChangePasswordForm() {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (newPassword.length < 8) return toast.error("New password must be at least 8 characters.");
    if (newPassword !== confirmPassword) return toast.error("New passwords don't match.");
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.message || "Failed to change password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground/90">
          <KeyRound className="h-3 w-3" /> Current password
        </Label>
        <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label className="mb-1.5 text-xs font-medium text-foreground/90">New password</Label>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1.5 text-xs font-medium text-foreground/90">Confirm new password</Label>
          <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </div>
      </div>
      <Button size="sm" disabled={submitting || !currentPassword || !newPassword} onClick={submit}>
        {submitting ? "Updating…" : "Change password"}
      </Button>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-accent">
        {icon} {title}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
