import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth, roleHome } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: RootRedirect,
});

function RootRedirect() {
  const { user, isHydrating } = useAuth();
  if (isHydrating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  return <Navigate to={user ? roleHome(user.role) : "/login"} replace />;
}