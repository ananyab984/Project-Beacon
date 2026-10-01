import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { AuthShell } from "@/components/features/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, roleHome, type Role } from "@/lib/auth";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type Search = { redirect?: string; verified?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
    verified: typeof s.verified === "string" ? s.verified : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const { signIn, sendVerificationOtp, completeProfile } = useAuth();
  const navigate = useNavigate();
  const { redirect, verified } = useSearch({ from: "/login" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Set only when signIn rejects with the one-time verification gate --
  // renders an inline resend box instead of a dead-end error toast.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  // Set when Neon Auth confirms this identity but no app profile exists yet
  // (never signed up through /signup's role picker, and no owner pre-invite
  // matched this email) -- lets them pick a role right here instead of a dead end.
  const [needsSetupEmail, setNeedsSetupEmail] = useState<string | null>(null);
  const [setupRole, setSetupRole] = useState<Role>("recruiter");
  const [settingUp, setSettingUp] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Browser/password-manager autofill frequently writes straight into the
    // DOM without firing the input events React's onChange relies on, which
    // left this form silently submitting empty strings -- reading the actual
    // form values at submit time is the only way to see what's really there.
    const formData = new FormData(e.currentTarget);
    const formEmail = String(formData.get("email") ?? email);
    const formPassword = String(formData.get("password") ?? password);
    const parsed = schema.safeParse({ email: formEmail, password: formPassword });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setUnverifiedEmail(null);
    setNeedsSetupEmail(null);
    setLoading(true);
    try {
      const u = await signIn(parsed.data.email, parsed.data.password);
      toast.success(`Welcome back, ${u.name.split(" ")[0]}`);
      navigate({ to: redirect ?? roleHome(u.role) });
    } catch (err: any) {
      if (err?.code === "NO_PROFILE") {
        setNeedsSetupEmail(err.email ?? parsed.data.email);
      } else if (err?.code === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(err.email ?? parsed.data.email);
      } else {
        // Was previously also treating any 403 as "email not verified" --
        // that was a guess (never confirmed against Neon's actual error
        // code) and it can misfire on an unrelated 403, showing the wrong
        // message and masking the real one. Show what Neon actually said.
        const suffix = err?.code ? ` (${err.code})` : "";
        toast.error(err instanceof Error ? `${err.message}${suffix}` : "Sign-in failed");
      }
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    if (!unverifiedEmail) return;
    setResending(true);
    try {
      await sendVerificationOtp(unverifiedEmail);
      toast.success(`Verification code sent to ${unverifiedEmail}`);
      navigate({ to: "/verify-email", search: { email: unverifiedEmail } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend verification code");
    } finally {
      setResending(false);
    }
  }

  async function onFinishSetup() {
    setSettingUp(true);
    try {
      const u = await completeProfile(setupRole);
      toast.success(`You're all set, ${u.name.split(" ")[0]}`);
      navigate({ to: redirect ?? roleHome(u.role) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not finish setting up your account");
    } finally {
      setSettingUp(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Enter your details to continue."
      footer={
        <div className="flex flex-col gap-1">
          <span>
            Don't have an account?{" "}
            <Link to="/signup" className="font-medium text-primary hover:underline">
              Create one
            </Link>
          </span>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {verified === "1" && !unverifiedEmail && !needsSetupEmail && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
            Email verified — sign in to continue.
          </div>
        )}

        {unverifiedEmail && (
          <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm">
            <p className="text-foreground">
              <span className="font-medium">{unverifiedEmail}</span> hasn&apos;t been verified yet. Check your inbox,
              or send a new code:
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onResend}
              disabled={resending}
              className="h-7 border-amber-500/40 bg-background/60 text-xs hover:bg-background"
            >
              {resending ? "Sending…" : "Resend verification code"}
            </Button>
          </div>
        )}

        {needsSetupEmail && (
          <div className="space-y-2.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
            <p className="text-foreground">
              <span className="font-medium">{needsSetupEmail}</span> is verified, but isn&apos;t set up in Global3 yet.
              Choose a role to finish:
            </p>
            <Select value={setupRole} onValueChange={(v) => setSetupRole(v as Role)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="recruiter">Recruiter</SelectItem>
                <SelectItem value="contractor">Contractor</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              onClick={onFinishSetup}
              disabled={settingUp}
              className="h-7 w-full text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {settingUp ? "Setting up…" : "Finish setup"}
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
              Forgot?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {loading ? "Signing in…" : "Sign in"}
        </Button>

      </form>
    </AuthShell>
  );
}
