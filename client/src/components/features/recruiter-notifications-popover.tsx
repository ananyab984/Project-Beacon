import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell, MessageSquare, RefreshCw, Wand2, ArrowRight, Check, AlertTriangle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";

export interface RecruiterNotification {
  id: string;
  type: "message_received" | "lead_update" | "draft_message" | "escalation";
  title: string;
  category: string;
  detail: string;
  timestamp: string;
  read: boolean;
}

function ageDays(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000));
}

function ageLabel(days: number): string {
  return days <= 0 ? "Today" : `${days}d ago`;
}

export function RecruiterNotificationsPopover() {
  const [open, setOpen] = useState(false);
  const [readState, setReadState] = useState<Record<string, boolean>>({});

  const { data } = useQuery({
    queryKey: ["escalations"],
    queryFn: api.getEscalations,
  });

  const escalationNotifs: RecruiterNotification[] = useMemo(() => {
    const list = data?.escalations ?? [];
    return list.map((e) => ({
      id: e.id,
      type: "escalation" as const,
      title: e.title,
      category: e.category,
      detail: e.detail,
      timestamp: ageLabel(ageDays(e.createdAt)),
      read: !!readState[e.id],
    }));
  }, [data, readState]);

  const allNotifications = useMemo(() => {
    return escalationNotifs;
  }, [escalationNotifs]);

  const unreadCount = allNotifications.filter((n) => !n.read).length;

  const markAllRead = () => {
    const next: Record<string, boolean> = {};
    allNotifications.forEach((n) => (next[n.id] = true));
    setReadState(next);
  };

  const typeIcon = (type: RecruiterNotification["type"]) => {
    switch (type) {
      case "message_received":
        return <MessageSquare className="h-3.5 w-3.5 text-accent" />;
      case "lead_update":
        return <RefreshCw className="h-3.5 w-3.5 text-primary" />;
      case "draft_message":
        return <Wand2 className="h-3.5 w-3.5 text-warning" />;
      case "escalation":
        return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
    }
  };

  const actionLink = (n: RecruiterNotification) => {
    switch (n.type) {
      case "message_received":
        return { label: "Reply to message", to: "/recruiter/conversations" };
      case "lead_update":
        return { label: "View lead update", to: "/recruiter/leads" };
      case "draft_message":
        return { label: "Draft message", to: "/recruiter/email-queue" };
      case "escalation":
        if (n.category === "Email Queue Threshold Alert") {
          return { label: "Review email queue", to: "/recruiter/email-queue" };
        }
        if (n.category === "Recruiter Performance") {
          return { label: "View performance", to: "/recruiter/performance" };
        }
        return { label: "Review lead", to: "/recruiter/leads" };
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) markAllRead(); }}>
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
            <h3 className="text-sm font-semibold text-foreground">Escalated Items</h3>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <Check className="h-3 w-3" /> Mark read
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
          {allNotifications.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No escalated items right now.
            </div>
          ) : (
            allNotifications.map((n) => {
              const act = actionLink(n);
              return (
                <div
                  key={n.id}
                  className={`p-3.5 transition-colors ${
                    !n.read ? "bg-primary/5" : "hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-muted/80 shrink-0">
                        {typeIcon(n.type)}
                      </span>
                      <div>
                        <div className="text-xs font-bold text-foreground">{n.title}</div>
                        <div className="text-[11px] text-muted-foreground font-medium">
                          <span className="text-accent">{n.category}</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{n.timestamp}</span>
                  </div>

                  <p className="mt-1.5 text-xs text-muted-foreground/90 pl-8 leading-normal">
                    {n.detail}
                  </p>

                  <div className="mt-2.5 flex justify-end pl-8">
                    <Link
                      to={act.to as any}
                      onClick={() => setOpen(false)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
                    >
                      {act.label} <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-border p-2.5 bg-muted/10 text-center">
          <Link
            to="/recruiter/leads"
            search={{ scope: "mine" }}
            onClick={() => setOpen(false)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            View all pending leads
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
