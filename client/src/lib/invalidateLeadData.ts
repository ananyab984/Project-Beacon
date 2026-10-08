import type { QueryClient } from "@tanstack/react-query";

/** Every cached view a lead's presence (or its deletion/restore) can affect --
 *  so a delete is reflected everywhere at once, not only on the page that did it. */
const LEAD_DEPENDENT_KEYS = [
  "leads", "lead", "my-leads", "leads-bin", "email-queue", "email-replies", "conversations",
  "outreach-funnel", "outreach-funnel-leads", "data-health", "reports-analytics", "escalations",
] as const;

export function invalidateLeadData(queryClient: QueryClient) {
  for (const key of LEAD_DEPENDENT_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
}
