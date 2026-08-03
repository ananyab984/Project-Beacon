import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthShell } from "@/components/g3/auth-shell";
import { Button } from "@/components/ui/button";
import { useAuth, roleHome } from "@/lib/auth";

export const Route = createFileRoute("/unauthorized")({ component: UnauthorizedPage });

function UnauthorizedPage() {
  const { user, signOut } = useAuth();
  return (
    <AuthShell title="Access denied" subtitle="You don't have permission to view that page.">
      <div className="space-y-3">
        {user && (
          <Button asChild className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to={roleHome(user.role)}>Go to your dashboard</Link>
          </Button>
        )}
        <Button variant="outline" className="w-full" onClick={signOut}>Sign out</Button>
      </div>
    </AuthShell>
  );
}