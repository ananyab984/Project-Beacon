import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { api } from "@/lib/api";

/** The per-lead "Notify me on response" bell -- a plain manual on/off toggle
 *  scoped to (lead, this recruiter). Stays on after firing; only turns off
 *  when clicked again. */
export function LeadNotifyBell({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["lead-notify-subscription", leadId],
    queryFn: () => api.getLeadNotifySubscription(leadId),
  });

  const active = data?.active ?? false;

  const toggle = useMutation({
    mutationFn: (next: boolean) => api.setLeadNotifySubscription(leadId, next),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["lead-notify-subscription", leadId] }),
  });

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate(!active);
      }}
      disabled={toggle.isPending}
      title={
        active
          ? "Notifying you on this lead's replies — click to turn off"
          : "Notify me when this lead replies"
      }
      className={`shrink-0 rounded p-0.5 transition-colors ${
        active ? "text-primary" : "text-muted-foreground/30 hover:text-muted-foreground"
      }`}
    >
      <Bell className={`h-3.5 w-3.5 ${active ? "fill-current" : ""}`} />
    </button>
  );
}
