import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Bell,
  MessageSquare,
  UserPlus,
  Clock,
  AlertTriangle,
  Check,
  ArrowRight,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import type { ApiNotification, NotificationType } from "@/lib/api-types";

function ageDays(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000));
}

function ageLabel(days: number): string {
  return days <= 0 ? "Today" : `${days}d ago`;
}

function typeIcon(type: NotificationType) {
  switch (type) {
    case "NEW_LEAD":
      return <UserPlus className="h-3.5 w-3.5 text-accent" />;
    case "TASK_ASSIGNMENT":
      return <Check className="h-3.5 w-3.5 text-primary" />;
    case "DUE_DATE_REMINDER":
      return <Clock className="h-3.5 w-3.5 text-warning" />;
    case "LEAD_RESPONSE":
      return <MessageSquare className="h-3.5 w-3.5 text-accent" />;
    case "ESCALATION":
      return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  }
}

export function RecruiterNotificationsPopover() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.getNotifications({ take: 20 }),
  });

  const { data: unreadData } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: api.getUnreadNotificationCount,
    refetchInterval: 60_000,
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = unreadData?.count ?? 0;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: invalidate,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: invalidate,
  });

  const handleOpen = (n: ApiNotification) => {
    if (!n.read) markReadMutation.mutate(n.id);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="relative h-9 px-2.5 text-xs font-medium bg-card border-border hover:bg-muted"
          title="Notifications"
        >
          <Bell className="h-4 w-4 text-foreground" />
          {unreadCount > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow-sm">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 sm:w-96 p-0 shadow-xl border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/20">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllReadMutation.mutate()}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <Check className="h-3 w-3" /> Mark all read
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No notifications right now.
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`p-3.5 transition-colors ${!n.read ? "bg-primary/5" : "hover:bg-muted/30"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-muted/80 shrink-0">
                      {typeIcon(n.type)}
                    </span>
                    <div className="text-xs font-bold text-foreground">{n.title}</div>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {ageLabel(ageDays(n.createdAt))}
                  </span>
                </div>

                <p className="mt-1.5 text-xs text-muted-foreground/90 pl-8 leading-normal">
                  {n.body}
                </p>

                {n.link && (
                  <div className="mt-2.5 flex justify-end pl-8">
                    <Link
                      to={n.link as any}
                      onClick={() => handleOpen(n)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
                    >
                      View <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border p-2.5 bg-muted/10 text-center">
          <Link
            to="/recruiter/leads"
            search={{ scope: "mine" }}
            className="text-xs font-semibold text-primary hover:underline"
          >
            View all pending leads
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
