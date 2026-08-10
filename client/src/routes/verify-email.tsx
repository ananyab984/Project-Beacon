import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AuthShell } from "@/components/features/auth-shell";
import { Button } from "@/components/ui/button";
import { useAuth, roleHome } from "@/lib/auth";

type Search = { token?: string };

export const Route = createFileRoute("/verify-email")({
  validateSearch: (s: Record<string, unknown>): Search => ({ token: typeof s.token === "string" ? s.token : undefined }),
  component: VerifyPage,
});

function VerifyPage() {
  const { verifyEmail, user } = useAuth();
  const navigate = useNavigate();
  const { token } = useSearch({ from: "/verify-email" });
  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!token || status !== "idle") return;
    setStatus("verifying");
    verifyEmail(token)
      .then((u) => {
        setStatus("success");
        setMessage(`Email verified for ${u.email}`);
        toast.success("Email verified");
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Verification failed");
      });
  }, [token, status, verifyEmail]);

  return (
    <AuthShell
      title="Verify your email"
      subtitle={
        status === "success" ? message
        : status === "error" ? message
        : status === "verifying" ? "Verifying your email…"
        : token ? "Preparing verification…" : "Open the verification link we sent to your inbox."
      }
    >
      <div className="space-y-3">
        {status === "success" && (
          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => navigate({ to: user ? roleHome(user.role) : "/login" })}
          >
            Continue
          </Button>
        )}
        {status !== "success" && (
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">Back to sign in</Link>
          </Button>
        )}
      </div>
    </AuthShell>
  );
}