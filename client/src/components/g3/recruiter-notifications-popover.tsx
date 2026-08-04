import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell, MessageSquare, RefreshCw, Wand2, ArrowRight, Check } from "lucide-react";
import { Link } from "@tanstack/react-router";

export interface RecruiterNotification {
  id: string;
  type: "message_received" | "lead_update" | "draft_message";
  title: string;
  leadName: string;
  language: string;
  detail: string;
  timestamp: string;
  read: boolean;
}

const INITIAL_NOTIFICATIONS: RecruiterNotification[] = [
  {
    id: "notif-1",
    type: "message_received",
    title: "Message received from candidate",
    leadName: "Takeshi Kovacs",
    language: "Japanese",
    detail: "Replied to outreach: 'Interested in Japanese Dubbing role. Available to start next week.'",
    timestamp: "10m ago",
    read: false,
  },
  {
    id: "notif-2",
    type: "lead_update",
    title: "Lead update",
    leadName: "Maria Garcia",
    language: "Spanish (Spain)",
    detail: "Secondary profile & vendor certifications automatically enriched by system.",
    timestamp: "1h ago",
    read: false,
  },
  {
    id: "notif-3",
    type: "draft_message",
    title: "Draft a message for new lead",
    leadName: "Jean Dupont",
    language: "French",
    detail: "New self-sourced lead assigned. Click 'Generate Draft' in Email Queue to reach out.",
    timestamp: "3h ago",
    read: false,
  },
];

export function RecruiterNotificationsPopover() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(INITIAL_NOTIFICATIONS);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const typeIcon = (type: RecruiterNotification["type"]) => {
    switch (type) {
      case "message_received":
        return <MessageSquare className="h-3.5 w-3.5 text-accent" />;
      case "lead_update":
        return <RefreshCw className="h-3.5 w-3.5 text-primary" />;
      case "draft_message":
        return <Wand2 className="h-3.5 w-3.5 text-warning" />;
    }
  };

  const actionLink = (type: RecruiterNotification["type"]) => {
    switch (type) {
      case "message_received":
        return { label: "Reply to message", to: "/recruiter/conversations" };
      case "lead_update":
        return { label: "View lead update", to: "/recruiter/leads" };
      case "draft_message":
        return { label: "Draft message", to: "/recruiter/email-queue" };
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
            <h3 className="text-sm font-semibold text-foreground">Lead Notifications</h3>
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
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No new lead notifications.
            </div>
          ) : (
            notifications.map((n) => {
              const act = actionLink(n.type);
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
                          {n.leadName} · <span className="text-accent">{n.language}</span>
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
