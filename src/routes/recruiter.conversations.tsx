import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useRecruiterStore } from "@/lib/recruiter-mock";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, Linkedin, Instagram, MessageCircle, Phone } from "lucide-react";

export const Route = createFileRoute("/recruiter/conversations")({
  head: () => ({ meta: [{ title: "Conversations — Global3 Recruiter" }] }),
  component: ConversationsPage,
});

export function ConversationsPage() {
  const store = useRecruiterStore();
  const [channel, setChannel] = useState<"LinkedIn" | "Instagram" | "WhatsApp" | "SMS">("LinkedIn");
  const [id, setId] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");

  const filtered = useMemo(
    () => store.conversations.filter((c) => c.channel === channel),
    [store.conversations, channel],
  );
  const conv = filtered.find((c) => c.id === id) ?? filtered[0];

  const counts = useMemo(() => {
    const acc: Record<string, number> = { LinkedIn: 0, Instagram: 0, WhatsApp: 0, SMS: 0 };
    for (const c of store.conversations) acc[c.channel] = (acc[c.channel] ?? 0) + 1;
    return acc;
  }, [store.conversations]);

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-7xl flex-col gap-3">
      <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
        <ChannelTab active={channel === "LinkedIn"} onClick={() => { setChannel("LinkedIn"); setId(undefined); }} icon={Linkedin} label="LinkedIn" count={counts.LinkedIn} />
        <ChannelTab active={channel === "Instagram"} onClick={() => { setChannel("Instagram"); setId(undefined); }} icon={Instagram} label="Instagram" count={counts.Instagram} />
        <ChannelTab active={channel === "WhatsApp"} onClick={() => { setChannel("WhatsApp"); setId(undefined); }} icon={MessageCircle} label="WhatsApp" count={counts.WhatsApp} />
        <ChannelTab active={channel === "SMS"} onClick={() => { setChannel("SMS"); setId(undefined); }} icon={Phone} label="SMS" count={counts.SMS} />
      </div>
      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 text-sm text-muted-foreground">
          No {channel} conversations yet.
        </div>
      ) : (
      <div className="flex-1 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid h-full grid-cols-1 md:grid-cols-[280px_1fr_280px]">
        {/* Threads */}
        <div className="border-r border-border">
          <div className="border-b border-border p-3">
            <div className="text-sm font-semibold">{channel} Conversations</div>
          </div>
          <div className="divide-y divide-border overflow-y-auto">
            {filtered.map((c) => (
              <button key={c.id} onClick={() => setId(c.id)} className={`block w-full p-3 text-left transition-colors ${conv?.id === c.id ? "bg-muted/60" : "hover:bg-muted/30"}`}>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center text-[11px] font-medium">{c.candidate_name.split(" ").map((s) => s[0]).slice(0, 2).join("")}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{c.candidate_name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{c.last_ago}</span>
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">{c.last_message}</div>
                  </div>
                  {c.unread && <span className="h-2 w-2 rounded-full bg-primary" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Thread */}
        {conv && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <div className="text-sm font-semibold">{conv.candidate_name}</div>
                <div className="text-[11px] text-muted-foreground">{conv.candidate_role}</div>
              </div>
              <Badge variant="outline" className="gap-1 text-[10px]"><ChannelIcon channel={conv.channel} className="h-3 w-3" />{conv.channel}</Badge>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {conv.messages.map((m, i) => (
                <div key={i} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${m.from === "me" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    <div>{m.text}</div>
                    <div className={`mt-1 text-[10px] ${m.from === "me" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{m.at}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border p-3">
              <div className="flex items-center gap-2">
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message…" className="flex-1" />
                <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setDraft("")}><Send className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </div>
        )}

        {/* Candidate context */}
        {conv && (
          <div className="border-l border-border p-4 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Candidate</div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">{conv.candidate_name[0]}</div>
              <div>
                <div className="text-sm font-semibold">{conv.candidate_name}</div>
                <div className="text-[11px] text-muted-foreground">{conv.candidate_role}</div>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-xs">
              <Row k="Channel" v={conv.channel} />
              <Row k="Status" v={conv.unread ? "Unread" : "Active"} />
              <Row k="Last activity" v={conv.last_ago} />
            </div>
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  );
}

function ChannelTab({ active, onClick, icon: Icon, label, count, comingSoon }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string; count?: number; comingSoon?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={comingSoon}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground disabled:opacity-60 disabled:hover:text-muted-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      {typeof count === "number" && <Badge variant="secondary" className="text-[9px]">{count}</Badge>}
      {comingSoon && <Badge variant="outline" className="text-[9px]">Soon</Badge>}
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-border/40 pb-1.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function ChannelIcon({ channel, className }: { channel: string; className?: string }) {
  const Icon = channel === "Instagram" ? Instagram : channel === "WhatsApp" ? MessageCircle : channel === "SMS" ? Phone : Linkedin;
  return <Icon className={className} />;
}