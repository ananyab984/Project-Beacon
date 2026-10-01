import { G3Logo } from "@/components/features/logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, LogOut } from "lucide-react";

export function RolePlaceholder({ role, title, description }: { role: string; title: string; description: string }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <G3Logo />
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium">{user?.name}</div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{role}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              signOut();
              navigate({ to: "/login", replace: true });
            }}
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
        <div className="mt-8 rounded-xl border border-border bg-card px-5 py-4 text-left text-xs text-muted-foreground">
          <div className="mb-1 font-semibold text-foreground/80">What's coming</div>
          <ul className="list-inside list-disc space-y-1">
            <li>Role-specific dashboard tuned to the daily workflow</li>
            <li>Notifications, tasks and pipeline health at a glance</li>
            <li>Deep-link handoffs to shared owner views</li>
          </ul>
        </div>
      </main>
    </div>
  );
}