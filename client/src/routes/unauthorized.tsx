import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AuthShell } from "@/components/features/auth-shell";
import { Button } from "@/components/ui/button";
import { useAuth, roleHome } from "@/lib/auth";

export const Route = createFileRoute("/unauthorized")({ component: UnauthorizedPage });

function UnauthorizedPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  // signOut() only clears the session; it never navigates, so this button
  // used to leave you on this same page with nothing left to click.
  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login", replace: true });
  }
  return (
    <AuthShell title="Access denied" subtitle="You don't have permission to view that page.">
      <div className="space-y-3">
        {user && (
          <Button asChild className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to={roleHome(user.role)}>Go to your dashboard</Link>
          </Button>
        )}
        {user ? (
          <Button variant="outline" className="w-full" onClick={handleSignOut}>
            Sign out
          </Button>
        ) : (
          <Button asChild className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to="/login" replace>
              Sign in
            </Link>
          </Button>
        )}
      </div>
    </AuthShell>
  );
}
