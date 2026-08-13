import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, Linkedin, Wand2, Loader2, Search, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ApiConversation, ApiConversationMessage, ApiLead } from "@/lib/api-types";
import { SearchLeadDialog } from "@/components/features/search-lead-dialog";
import { SelectAccountDialog } from "@/components/features/select-account-dialog";
import { ConnectAccountDialog } from "@/components/features/connect-account-dialog";

function candidateName(conv: ApiConversation): string {
  return conv.candidateName || conv.lead?.fullName || conv.lead?.displayName || "Unknown";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return "";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ConversationsPageView() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["conversations"],
    queryFn: api.getConversations,
  });
  const conversations = data?.conversations ?? [];

  const [id, setId] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [searchThread, setSearchThread] = useState("");

  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectAccountDialogOpen, setSelectAccountDialogOpen] = useState(false);
  const [targetChannelAccounts, setTargetChannelAccounts] = useState<any[]>([]);

  const filtered = useMemo(
    () => conversations.filter((c: ApiConversation) => c.channel === "LINKEDIN"),
    [conversations]
  );

  const searchedFiltered = useMemo(() => {
    if (!searchThread.trim()) return filtered;
    const query = searchThread.toLowerCase();
    return filtered.filter(
      (c: ApiConversation) =>
        candidateName(c).toLowerCase().includes(query) ||
        (c.candidateRole || "").toLowerCase().includes(query)
    );
  }, [filtered, searchThread]);

  const conv = searchedFiltered.find((c: ApiConversation) => c.id === id) ?? searchedFiltered[0];

  useEffect(() => {
    setTo(conv?.lead?.profileLink || "");
  }, [conv?.id]);

  const pickConv = (convId: string) => {
    setId(convId);
    setDraft("");
  };

  const handleGenerateLinkedInDraft = async () => {
    if (!conv) return;
    setIsGeneratingDraft(true);
    try {
      const { draft: generated } = await api.generateLinkedInDraft(conv.id);
      setDraft(generated.body);
      toast.success(`Generated official LinkedIn draft for ${candidateName(conv)}!`);
    } catch (err: any) {
      if (err.status === 502 || err.code === "DRAFTING_SERVICE_UNAVAILABLE") {
        toast.error("Drafting service unavailable — write the message manually");
      } else {
        toast.error(err.message || "Failed to generate draft");
      }
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const handleSelectLeadFromSearch = async (lead: ApiLead) => {
    try {
      const { conversation } = await api.createConversation(lead.id);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setId(conversation.id);
      setDraft("");
      setTo(lead.profileLink || "");
      const name = lead.fullName || lead.displayName || "Candidate";
      toast.success(`Loaded candidate ${name}. Click Generate Draft for a personalized message.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to load lead into conversation");
    }
  };

  async function initiateSend() {
    if (!draft.trim() || !conv) return;

    try {
      const accounts = await api.getConnectedAccounts();
      const active = accounts.filter((a: any) => a.status !== "DISCONNECTED");

      const linkedInAccs = active.filter((a: any) =>
        (a.provider || "").toUpperCase().includes("LINKEDIN")
      );

      if (linkedInAccs.length === 0) {
        toast.error("No connected LinkedIn account found", {
          action: { label: "Connect Account", onClick: () => setConnectDialogOpen(true) },
        });
        return;
      }

      if (linkedInAccs.length > 1) {
        setTargetChannelAccounts(linkedInAccs);
        setSelectAccountDialogOpen(true);
        return;
      }

      // Single connected account -> execute send directly
      await executeSend(linkedInAccs[0].unipileAccountId);
    } catch (err: any) {
      toast.error(err.message || "Failed to check connected accounts");
    }
  }

  async function executeSend(accountId?: string) {
    if (!draft.trim() || !conv) return;
    setSending(true);
    try {
      await api.sendConversationMessage(conv.id, draft.trim(), accountId, to.trim() || undefined);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("Message dispatched via LinkedIn!");
      setDraft("");
      setSelectAccountDialogOpen(false);
    } catch (err: any) {
      if (err.code === "ACCOUNT_NOT_CONNECTED" || err.message?.includes("connect")) {
        toast.error("Unipile LinkedIn account not connected", {
          action: { label: "Connect Account", onClick: () => setConnectDialogOpen(true) },
        });
      } else {
        toast.error(err.message || "Failed to send LinkedIn message");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-7xl flex-col gap-3">
      {/* Header bar */}
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

        <div className="flex items-center gap-2">
          {/* Search Lead Dialog */}
          <SearchLeadDialog
            onSelectLead={handleSelectLeadFromSearch}
            title="Search & Add Lead to Conversations"
            description="Select a lead from the database. Enriched profile details & LinkedIn outreach draft will be auto-prefilled."
            trigger={
              <Button size="sm" variant="outline" className="h-8 text-xs font-semibold gap-1.5 border-border">
                <Search className="h-3.5 w-3.5 text-primary" /> Search Lead
              </Button>
            }
          />
          <Badge variant="outline" className="text-xs font-semibold px-2.5 py-1 gap-1.5">
            <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
            {filtered.length} Active Threads
          </Badge>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading conversations…
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 text-sm text-destructive">
          Failed to load conversations{(error as any)?.message ? `: ${(error as any).message}` : "."}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 text-sm text-muted-foreground flex-col gap-3">
          <div>No LinkedIn conversations yet.</div>
          <SearchLeadDialog
            onSelectLead={handleSelectLeadFromSearch}
            trigger={
              <Button size="sm" className="bg-primary text-primary-foreground text-xs gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Search & Select Lead to Start Outreach
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid h-full grid-cols-1 md:grid-cols-[280px_1fr_280px]">
            {/* Threads Sidebar */}
            <div className="border-r border-border flex flex-col h-full">
              <div className="border-b border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">LinkedIn Conversations</div>
                  <SearchLeadDialog
                    onSelectLead={handleSelectLeadFromSearch}
                    trigger={
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-primary gap-1">
                        <Plus className="h-3.5 w-3.5" /> Add
                      </Button>
                    }
                  />
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search threads…"
                    value={searchThread}
                    onChange={(e) => setSearchThread(e.target.value)}
                    className="pl-8 h-8 text-xs bg-muted/30"
                  />
                </div>
              </div>
              <div className="divide-y divide-border overflow-y-auto flex-1">
                {searchedFiltered.map((c: ApiConversation) => {
                  const lastMessage = c.messages[c.messages.length - 1];
                  return (
                    <button key={c.id} onClick={() => pickConv(c.id)} className={`block w-full p-3 text-left transition-colors ${conv?.id === c.id ? "bg-muted/60" : "hover:bg-muted/30"}`}>
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center text-[11px] font-medium">{candidateName(c).split(" ").map((s: string) => s[0]).slice(0, 2).join("")}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{candidateName(c)}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(c.lastMessageAt)}</span>
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">{lastMessage?.text ?? "No messages yet"}</div>
                        </div>
                        {c.unread && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Main Thread Content */}
            {conv && (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-border p-4">
                  <div>
                    <div className="text-sm font-semibold flex items-center gap-2">
                      {candidateName(conv)}
                      {conv.lead?.profileLink && (
                        <a href={conv.lead.profileLink} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline">
                          (Enriched Profile)
                        </a>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{conv.candidateRole}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleGenerateLinkedInDraft}
                      disabled={isGeneratingDraft}
                      size="sm"
                      className="h-8 text-xs bg-primary text-primary-foreground font-semibold gap-1.5 shadow-xs"
                    >
                      {isGeneratingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      {isGeneratingDraft ? "Generating…" : "Generate Draft"}
                    </Button>
                    <Badge variant="outline" className="gap-1 text-[10px]"><Linkedin className="h-3 w-3" />LinkedIn</Badge>
                  </div>
                </div>

                <div className="border-b border-border px-4 py-2.5">
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">To</label>
                  <Input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="https://www.linkedin.com/in/…"
                    className="mt-1 h-8 text-xs"
                  />
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {conv.messages.map((m: ApiConversationMessage) => (
                    <div key={m.id} className={`flex ${m.sender === "ME" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${m.sender === "ME" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        <div>{m.text}</div>
                        <div className={`mt-1 text-[10px] ${m.sender === "ME" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{timeAgo(m.sentAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Direct Message (300-char max)</span>
                    <button
                      onClick={handleGenerateLinkedInDraft}
                      disabled={isGeneratingDraft}
                      className="text-accent hover:underline font-semibold flex items-center gap-1 disabled:opacity-50"
                    >
                      {isGeneratingDraft ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                      {isGeneratingDraft ? "Generating…" : "Generate Personalized Draft"}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Click 'Generate Draft' button above to generate LinkedIn message..."
                      className="flex-1 text-xs"
                      disabled={sending}
                    />
                    <Button size="sm" disabled={sending || !draft.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={initiateSend}>
                      {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Candidate Context Sidebar */}
            {conv && (
              <div className="border-l border-border p-4 overflow-y-auto space-y-4">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Candidate</div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">{candidateName(conv)[0]}</div>
                    <div>
                      <div className="text-sm font-semibold">{candidateName(conv)}</div>
                      <div className="text-[11px] text-muted-foreground">{conv.candidateRole}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <Row k="Channel" v="LinkedIn" />
                  <Row k="Enriched Link" v={conv.lead?.profileLink ? "Available" : "N/A"} />
                  <Row k="Status" v={conv.unread ? "Unread" : "Active"} />
                  <Row k="Last activity" v={timeAgo(conv.lastMessageAt)} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Connection & Account Select Modals */}
      <ConnectAccountDialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen} />
      <SelectAccountDialog
        open={selectAccountDialogOpen}
        onOpenChange={setSelectAccountDialogOpen}
        accounts={targetChannelAccounts}
        channel="LINKEDIN"
        onSelectAccount={(accountId) => executeSend(accountId)}
        isSending={sending}
      />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-border/40 pb-1.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium truncate max-w-[140px]">{v}</span>
    </div>
  );
}
