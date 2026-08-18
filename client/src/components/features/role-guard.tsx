import { Navigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAuth, type Role } from "@/lib/auth";

export function RoleGuard({ role, children }: { role: Role; children: ReactNode }) {
  const { user, isHydrating } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (isHydrating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" search={{ redirect: pathname }} replace />;
  if (String(user.role).toLowerCase() !== String(role).toLowerCase()) return <Navigate to="/unauthorized" replace />;
  return <>{children}</>;
}