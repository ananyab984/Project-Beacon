import { useMemo, useState } from "react";
import { useEmailQueueStore } from "@/stores/useEmailQueueStore";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, Linkedin, Wand2 } from "lucide-react";
import { generateLinkedInDraft } from "@/components/features/email-queue-page-view";
import { toast } from "sonner";

export function ConversationsPageView() {
  const { conversations, addConversationMessage } = useEmailQueueStore();
  const [id, setId] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");

  const filtered = useMemo(
    () => conversations.filter((c) => c.channel === "LinkedIn" || true).map(c => ({ ...c, channel: "LinkedIn" as const })),
    [conversations],
  );
  const conv = filtered.find((c) => c.id === id) ?? filtered[0];

  const pickConv = (convId: string) => {
    setId(convId);
    setDraft("");
  };

  const handleGenerateLinkedInDraft = () => {
    if (!conv) return;
    const generated = generateLinkedInDraft(conv.candidate_name, conv.candidate_role || "Linguist");
    setDraft(generated);
    toast.success(`Generated official LinkedIn draft for ${conv.candidate_name}!`);
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-7xl flex-col gap-3">
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-[#0A66C2]/15 p-2 text-[#0A66C2]">
            <Linkedin className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              LinkedIn Conversations
              <Badge variant="secondary" className="text-[10px] bg-[#0A66C2]/10 text-[#0A66C2] font-semibold border border-[#0A66C2]/20">
                Official Channel
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">Direct messaging, candidate replies, and outreach follow-ups via LinkedIn.</p>
          </div>
        </div>
        <Badge variant="outline" className="text-xs font-semibold px-2.5 py-1 gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
          {filtered.length} Active Threads
        </Badge>
      </div>
      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 text-sm text-muted-foreground">
          No LinkedIn conversations yet.
        </div>
      ) : (
      <div className="flex-1 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid h-full grid-cols-1 md:grid-cols-[280px_1fr_280px]">
        {/* Threads */}
        <div className="border-r border-border">
          <div className="border-b border-border p-3">
            <div className="text-sm font-semibold">LinkedIn Conversations</div>
          </div>
          <div className="divide-y divide-border overflow-y-auto">
            {filtered.map((c) => (
              <button key={c.id} onClick={() => pickConv(c.id)} className={`block w-full p-3 text-left transition-colors ${conv?.id === c.id ? "bg-muted/60" : "hover:bg-muted/30"}`}>
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
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleGenerateLinkedInDraft}
                  size="sm"
                  className="h-8 text-xs bg-primary text-primary-foreground font-semibold gap-1.5 shadow-xs"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Generate Draft
                </Button>
                <Badge variant="outline" className="gap-1 text-[10px]"><Linkedin className="h-3 w-3" />LinkedIn</Badge>
              </div>
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
            <div className="border-t border-border p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Direct Message</span>
                <button
                  onClick={handleGenerateLinkedInDraft}
                  className="text-accent hover:underline font-semibold flex items-center gap-1"
                >
                  <Wand2 className="h-3 w-3" /> Auto-fill LinkedIn Template
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Click 'Generate Draft' button above to generate LinkedIn message..."
                  className="flex-1 text-xs"
                />
                <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => { if (draft.trim() && conv) { addConversationMessage(conv.id, draft.trim()); toast.success("Message dispatched via LinkedIn!"); setDraft(""); } }}><Send className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </div>
        )}

        {/* Candidate context */}
        {conv && (
          <div className="border-l border-border p-4 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Candidate</div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">{conv.candidate_name[0]}</div>
              <div>
                <div className="text-sm font-semibold">{conv.candidate_name}</div>
                <div className="text-[11px] text-muted-foreground">{conv.candidate_role}</div>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-xs">
              <Row k="Channel" v="LinkedIn" />
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-border/40 pb-1.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
