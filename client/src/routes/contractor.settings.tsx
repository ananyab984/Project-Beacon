import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { KeyRound, Mail, ShieldCheck, User as UserIcon, Bell, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { NotificationType } from "@/lib/api-types";

// Same lookup used by recruiter.settings.tsx -- kept as its own local copy
// rather than a shared import since each settings page owns its own display
// text and the two are free to diverge later.
const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  NEW_LEAD: "New lead application",
  TASK_ASSIGNMENT: "Task assignment",
  DUE_DATE_REMINDER: "Project due-date reminder",
  LEAD_RESPONSE: "Lead response (per-lead bell, set on each lead's row)",
  ESCALATION: "Escalated items",
};

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

  const updatePrefMutation = useMutation({
    mutationFn: ({
      type,
      patch,
    }: {
      type: NotificationType;
      patch: { emailEnabled?: boolean; slackEnabled?: boolean };
    }) => api.updateNotificationPreference(type, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-preferences"] }),
    onError: (err: any) => toast.error(err?.message || "Failed to update notification preference"),
  });

  const [slackMemberId, setSlackMemberId] = useState(user?.slackMemberId ?? "");
  const slackMutation = useMutation({
    mutationFn: () => api.updateSlackMemberId(user!.id, slackMemberId.trim() || null),
    onSuccess: () => toast.success("Slack member ID saved"),
    onError: (err: any) => toast.error(err?.message || "Failed to save Slack member ID"),
  });

  const preferences = prefsData?.preferences ?? [];
  const alwaysOnBellTypes = new Set(prefsData?.alwaysOnBellTypes ?? []);

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
          The in-app bell is always on for new leads, task assignments, due-date reminders, and
          escalations. Turn on email or Slack for any type below.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 px-4 font-medium">Bell</th>
                <th className="py-2 px-4 font-medium">Email</th>
                <th className="py-2 px-4 font-medium">Slack</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {preferences.map((p) => (
                <tr key={p.type}>
                  <td className="py-3 pr-4 font-medium text-foreground">
                    {NOTIFICATION_TYPE_LABELS[p.type]}
                  </td>
                  <td className="py-3 px-4">
                    {alwaysOnBellTypes.has(p.type) ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <Switch
                      checked={p.emailEnabled}
                      onCheckedChange={(checked) =>
                        updatePrefMutation.mutate({
                          type: p.type,
                          patch: { emailEnabled: checked },
                        })
                      }
                    />
                  </td>
                  <td className="py-3 px-4">
                    <Switch
                      checked={p.slackEnabled}
                      onCheckedChange={(checked) =>
                        updatePrefMutation.mutate({
                          type: p.type,
                          patch: { slackEnabled: checked },
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
