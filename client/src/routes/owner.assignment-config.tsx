import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/owner/assignment-config")({
  component: RedirectToClients,
});

function RedirectToClients() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/owner/clients", replace: true });
  }, [navigate]);
  return null;
}
