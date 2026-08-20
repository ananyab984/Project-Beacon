import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AuthShell } from "@/components/features/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

type Search = { email?: string };

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export const Route = createFileRoute("/verify-email")({
  validateSearch: (s: Record<string, unknown>): Search => ({ email: str(s.email) }),
  component: VerifyPage,
});

/**
 * Neon Auth's shared sender emails a 6-digit code (not a link) -- see
 * server/.env for the console toggle. Verifying does not sign the person in;
 * /login is still the only place a session ever starts.
 */
function VerifyPage() {
  const { verifyEmailOtp, sendVerificationOtp } = useAuth();
  const navigate = useNavigate();
  const { email: emailParam } = useSearch({ from: "/verify-email" });

  const [email, setEmail] = useState(emailParam ?? "");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return toast.error("Enter the email address you signed up with");
    if (code.trim().length < 6) return toast.error("Enter the 6-digit code from your email");

    setVerifying(true);
    try {
      await verifyEmailOtp(email.trim(), code.trim());
      toast.success("Email verified");
      navigate({ to: "/login", search: { verified: "1" } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That code didn't work");
    } finally {
      setVerifying(false);
    }
  }

  async function onResend() {
    if (!email.trim()) return toast.error("Enter the email address you signed up with");
    setResending(true);
    try {
      await sendVerificationOtp(email.trim());
      toast.success("New code sent — check your inbox");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend the code");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      title="Verify your email"
      subtitle={`Enter the 6-digit code we emailed to ${email || "your inbox"}.`}
    >
      <form onSubmit={onVerify} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="verify-email">Email address</Label>
          <Input
            id="verify-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@global3.io"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="verify-code">Verification code</Label>
          <Input
            id="verify-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            maxLength={6}
          />
        </div>
        <Button type="submit" disabled={verifying} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
          {verifying ? "Verifying…" : "Verify email"}
        </Button>
        <Button type="button" variant="outline" onClick={onResend} disabled={resending} className="w-full">
          {resending ? "Sending…" : "Resend code"}
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </form>
    </AuthShell>
  );
}
