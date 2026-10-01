import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// This page became /contractor/clients (same table, plus client identity on
// the requirements assigned to you). Kept as a redirect rather than deleted:
// TASK_ASSIGNMENT / DUE_DATE_REMINDER notifications already delivered to
// contractors carry this path in `Notification.link`, and those rows are
// permanent -- a deleted route would 404 them. Same pattern as
// owner.assignment-config.tsx.
export const Route = createFileRoute("/contractor/requirements")({
  component: RedirectToClients,
});

function RedirectToClients() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/contractor/clients", replace: true });
  }, [navigate]);
  return null;
}
