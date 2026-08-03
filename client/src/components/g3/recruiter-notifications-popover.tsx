import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, MessageSquare, ArrowRight, Linkedin, CheckCircle2, Clock } from "lucide-react";
import { Link } from "@tanstack/react-router";

export interface LeadNotification {
  id: string;
  candidateName: string;
  language: string;
  updateText: string;
  snippet?: string;
  timeAgo: string;
  status: "replied" | "awaiting" | "onboarded";
  read: boolean;
}

const INITIAL_NOTIFICATIONS: LeadNotification[] = [
  {
    id: "notif-1",
    candidateName: "Elena Rostova",
    language: "Spanish (LatAm)",
    updateText: "Responded to LinkedIn outreach",
    snippet: "Yes, I am available for the Netflix LatAm project! Let's discuss terms.",
    timeAgo: "15m ago",
    status: "replied",
    read: false,
  },
  {
    id: "notif-2",
    candidateName: "Klaus Webber",
    language: "German",
    updateText: "Responded to LinkedIn outreach",
    snippet: "Thanks for reaching out! I reviewed the requirements and sent my CV.",
    timeAgo: "2h ago",
    status: "replied",
    read: false,
  },
  {
    id: "notif-3",
    candidateName: "Yuki Tanaka",
    language: "Japanese",
    updateText: "Responded to LinkedIn outreach",
    snippet: "Interested in this role. Can we schedule a brief call tomorrow?",
    timeAgo: "5h ago",
    status: "replied",
    read: false,
  },
  {
    id: "notif-4",
    candidateName: "Marco Rossi",
    language: "Italian",
    updateText: "Outreach sent · Awaiting candidate response",
    timeAgo: "2 days ago",
    status: "awaiting",
    read: true,
  },
  {
    id: "notif-5",
    candidateName: "Amira El-Sayed",
    language: "Arabic",
    updateText: "Outreach sent · Awaiting candidate response",
    timeAgo: "3 days ago",
    status: "awaiting",
    read: true,
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
          className="relative h-9 gap-1.5 px-3 text-xs font-medium"
        >
          <Bell className="h-4 w-4 text-foreground" />
          <span className="hidden sm:inline">Notifications</span>
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
          <Badge variant="outline" className="text-[10px] gap-1 bg-background">
            <Linkedin className="h-3 w-3 text-[#0A66C2]" /> LinkedIn Status
          </Badge>
        </div>

        {/* Notifications List */}
        <div className="max-h-80 overflow-y-auto divide-y divide-border">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No notifications yet.
            </div>
          ) : (
            notifications.map((item) => (
              <div
                key={item.id}
                className={`p-3.5 transition-colors hover:bg-muted/30 ${
                  !item.read ? "bg-accent/5" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      item.status === "replied" ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"
                    }`}>
                      {item.candidateName.split(" ").map(n => n[0]).join("")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground truncate">{item.candidateName}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">· {item.language}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] font-medium text-foreground/80 mt-0.5">
                        {item.status === "replied" ? (
                          <CheckCircle2 className="h-3 w-3 text-accent shrink-0" />
                        ) : (
                          <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        <span className="truncate">{item.updateText}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{item.timeAgo}</span>
                </div>

                {item.snippet && (
                  <div className="mt-2 rounded-md border border-accent/20 bg-background/80 p-2 text-xs">
                    <div className="flex items-start gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                      <p className="text-foreground/90 italic leading-snug">"{item.snippet}"</p>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-2.5 bg-muted/20 text-center">
          <Link
            to="/recruiter/conversations"
            onClick={() => setOpen(false)}
            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            View LinkedIn Conversations <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
