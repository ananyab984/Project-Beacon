import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Mail, ShieldCheck, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

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
