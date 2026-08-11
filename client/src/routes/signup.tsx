import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { AuthShell } from "@/components/features/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  role: z.enum(["recruiter", "contractor"]),
});

export const Route = createFileRoute("/signup")({ component: SignupPage });

function SignupPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "recruiter" as "recruiter" | "contractor" });
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      const { verifyToken } = await signUp(parsed.data);
      toast.success("Account created — check your email to verify", {
        description: "Demo mode: click Copy to grab the verification link.",
        action: {
          label: "Copy link",
          onClick: () => navigator.clipboard.writeText(`${window.location.origin}/verify-email?token=${verifyToken}`),
        },
      });
      navigate({ to: "/verify-email", search: { token: verifyToken } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Join Global3 to start managing your pipeline."
      footer={<span>Already have an account? <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link></span>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sarah Jenkins" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="sarah@global3.io" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["recruiter", "contractor"] as const).map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => setForm({ ...form, role: r })}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  form.role === r ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="font-medium capitalize">{r}</div>
                <div className="text-[11px] text-muted-foreground">
                  {r === "recruiter" ? "Manage leads & outreach" : "Deliver on client projects"}
                </div>
              </button>
            ))}
          </div>
          <p className="pt-1 text-[11px] text-muted-foreground">Owner accounts are invite-only.</p>
        </div>
        <Button type="submit" disabled={loading} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}