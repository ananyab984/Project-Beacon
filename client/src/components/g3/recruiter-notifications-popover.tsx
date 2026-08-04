import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell, AlertTriangle, ArrowRight, Check } from "lucide-react";
import { Link } from "@tanstack/react-router";

export interface RecruiterNotification {
  id: string;
  leadId: string;
  leadName: string;
  language: string;
  reason: string;
  timestamp: string;
  status: "pending" | "resolved" | "awaiting";
  read: boolean;
}

const INITIAL_NOTIFICATIONS: RecruiterNotification[] = [
  {
    id: "notif-1",
    leadId: "lead-hold-1",
    leadName: "Takeshi Kovacs",
    language: "Japanese",
    reason: "Missing secondary email verification",
    timestamp: "10m ago",
    status: "pending",
    read: false,
  },
  {
    id: "notif-2",
    leadId: "lead-hold-2",
    leadName: "Maria Garcia",
    language: "Spanish (Spain)",
    reason: "Certifications profile incomplete",
    timestamp: "1h ago",
    status: "pending",
    read: false,
  },
  {
    id: "notif-3",
    leadId: "lead-hold-3",
    leadName: "Jean Dupont",
    language: "French",
    reason: "Phone number parsing error",
    timestamp: "3h ago",
    status: "awaiting",
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
            notifications.map((n) => (
              <div
                key={n.id}
                className={`p-3.5 transition-colors ${
                  !n.read ? "bg-primary/5" : "hover:bg-muted/30"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-warning/15 text-warning shrink-0">
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-xs font-bold text-foreground">{n.leadName}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {n.language}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{n.timestamp}</span>
                </div>

                <p className="mt-1 text-xs text-muted-foreground pl-8">
                  {n.reason}
                </p>

                <div className="mt-2.5 flex justify-end pl-8">
                  <Link
                    to="/recruiter/leads"
                    search={{ scope: "mine" }}
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
                  >
                    Review lead <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ))
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
