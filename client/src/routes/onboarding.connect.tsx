import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth, roleHome } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Linkedin,
  Mail,
  ExternalLink,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Zap,
} from "lucide-react";

export const Route = createFileRoute("/onboarding/connect")({
  head: () => ({
    meta: [
      { title: "Set Up Outreach — Global3" },
      { name: "description", content: "Connect your LinkedIn and Email accounts to send outreach via Unipile." },
    ],
  }),
  component: OnboardingConnectPage,
});

type ProviderStatus = "idle" | "loading" | "opened";

function getAccessToken(): string | null {
  try {
    const raw = localStorage.getItem("g3.session.v2");
    if (raw) {
      const session = JSON.parse(raw);
      return session.accessToken || null;
    }
  } catch {}
  return null;
}

function OnboardingConnectPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [linkedinStatus, setLinkedinStatus] = useState<ProviderStatus>("idle");
  const [emailStatus, setEmailStatus] = useState<ProviderStatus>("idle");

  const apiBase = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5001").replace(/\/+$/, "");

  async function handleConnect(provider: "LINKEDIN" | "EMAIL") {
    const setter = provider === "LINKEDIN" ? setLinkedinStatus : setEmailStatus;
    setter("loading");

    const token = getAccessToken();
    try {
      const res = await fetch(`${apiBase}/api/unipile/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to generate connection link");

      // Open Unipile hosted-auth in a new window — same as the POC
      window.open(data.url, "_blank", "width=600,height=700,noopener,noreferrer");
      setter("opened");
      toast.success(`${provider === "LINKEDIN" ? "LinkedIn" : "Email"} connection window opened — complete setup there.`);
    } catch (err: any) {
      setter("idle");
      toast.error(err.message || `Failed to initiate ${provider} connection`);
    }
  }

  function handleContinue() {
    navigate({ to: user ? roleHome(user.role) : "/login" });
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-6">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Zap className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Set up your outreach</h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Connect your LinkedIn and Email accounts to send outreach directly from Global3 — powered by Unipile.
          </p>
        </div>

        {/* Connection cards */}
        <div className="space-y-3">
          <ProviderCard
            icon={<Linkedin className="h-5 w-5" />}
            iconBg="bg-blue-500/10 text-blue-500"
            title="LinkedIn Account"
            description="Send connection requests & direct messages"
            status={linkedinStatus}
            onConnect={() => handleConnect("LINKEDIN")}
          />
          <ProviderCard
            icon={<Mail className="h-5 w-5" />}
            iconBg="bg-amber-500/10 text-amber-500"
            title="Email Account"
            description="Gmail, Outlook, or any IMAP mailbox with open tracking"
            status={emailStatus}
            onConnect={() => handleConnect("EMAIL")}
          />
        </div>

        {/* Security note */}
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/20 px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Your credentials are never stored by Global3. Account linking is handled entirely by
            Unipile's secure hosted-auth flow — you authenticate directly with LinkedIn or your
            email provider.
          </p>
        </div>

        {/* Continue button */}
        <Button
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
          onClick={handleContinue}
        >
          {linkedinStatus === "opened" || emailStatus === "opened"
            ? "Continue to dashboard"
            : "Skip for now"}
          <ArrowRight className="h-4 w-4" />
        </Button>

        {(linkedinStatus !== "opened" && emailStatus !== "opened") && (
          <p className="text-center text-xs text-muted-foreground">
            You can always connect accounts later from the Email Queue page.
          </p>
        )}
      </div>
    </div>
  );
}

function ProviderCard({
  icon,
  iconBg,
  title,
  description,
  status,
  onConnect,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  status: ProviderStatus;
  onConnect: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-xs transition-all hover:border-accent/30 hover:shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
          {icon}
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
      </div>

      {status === "opened" ? (
        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-500 shrink-0">
          <CheckCircle2 className="h-4 w-4" />
          Window opened
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={status === "loading"}
          onClick={onConnect}
          className="shrink-0 gap-1.5 text-xs font-medium"
        >
          {status === "loading" ? "Opening…" : "Connect"}
          {status === "idle" && <ExternalLink className="h-3.5 w-3.5" />}
        </Button>
      )}
    </div>
  );
}
