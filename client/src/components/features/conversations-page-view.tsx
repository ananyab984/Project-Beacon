import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Linkedin,
  Wand2,
  Loader2,
  Search,
  Plus,
  Smile,
  Image as ImageIcon,
  Paperclip,
  Lock,
  MessageCircle,
  MessageCircleQuestion,
} from "lucide-react";
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

function formatMessageTime(iso: string | null): string {
  if (!iso) return "10:30 AM";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "10:30 AM";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getDefaultDraft(name: string, role?: string | null): string {
  return `Hi ${name}, noticed your work in ${role || "Dubbing & Subtitling"} -- we'd love to have you at Global3. Apply here: https://app.global3.io/apply`;
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
  const [isCheckingFaq, setIsCheckingFaq] = useState(false);
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
    if (!conv) return;
    setTo(conv.lead?.profileLink || (conv.lead?.email ? conv.lead.email : ""));
  }, [conv?.id, conv?.lead?.profileLink, conv?.lead?.email]);

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
      setDraft(getDefaultDraft(candidateName(conv), conv.candidateRole));
      toast.info("Loaded official LinkedIn template draft.");
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const handleCheckFaq = async () => {
    if (!conv) return;
    const lastLeadMessage = [...conv.messages].reverse().find((m: ApiConversationMessage) => m.sender === "THEM");
    if (!lastLeadMessage) {
      toast.error("No reply from the candidate yet to check");
      return;
    }
    setIsCheckingFaq(true);
    try {
      const result = await api.checkFaq(lastLeadMessage.text);
      if (result.match && result.answer) {
        setDraft(result.answer);
        toast.success(`FAQ match found: "${result.matchedQuestion}"`);
      } else {
        toast.info("No confident FAQ match for this reply");
      }
    } catch (err: any) {
      if (err.status === 502 || err.code === "DRAFTING_SERVICE_UNAVAILABLE") {
        toast.error("Drafting service unavailable — check the FAQ manually");
      } else {
        toast.error(err.message || "Failed to check FAQ");
      }
    } finally {
      setIsCheckingFaq(false);
    }
  };

  const handleSelectLeadFromSearch = async (lead: ApiLead) => {
    try {
      const { conversation } = await api.createConversation(lead.id);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setId(conversation.id);
      const name = lead.fullName || lead.displayName || "Candidate";
      setDraft(getDefaultDraft(name, lead.services.join(", ") || lead.targetLanguage));
      setTo(lead.profileLink || "");
      toast.success(`Added ${name} to LinkedIn Conversations!`);
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
    <div className="mx-auto flex h-[calc(100vh-8.5rem)] max-w-7xl flex-col gap-2 overflow-hidden">
      {/* Header bar */}
      <div className="shrink-0 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-[#0A66C2]/15 p-1.5 text-[#0A66C2]">
            <Linkedin className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              LinkedIn Conversations
              <Badge variant="secondary" className="text-[10px] bg-[#0A66C2]/10 text-[#0A66C2] font-semibold border border-[#0A66C2]/20">
                Official Channel
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">Direct messaging, candidate replies, and outreach follow-ups via LinkedIn.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search Lead Dialog */}
          <SearchLeadDialog
            onSelectLead={handleSelectLeadFromSearch}
            title="Search & Add Lead to Conversations"
            description="Select a lead from the database. Enriched profile details & LinkedIn outreach draft will be auto-prefilled."
            trigger={
              <Button size="sm" variant="outline" className="h-7 text-xs font-semibold gap-1.5 border-border">
                <Search className="h-3 w-3 text-primary" /> Search Lead
              </Button>
            }
          />
          <Badge variant="outline" className="text-xs font-semibold px-2 py-0.5 gap-1.5">
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
        <div className="flex-1 min-h-0 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[280px_1fr_280px]">
            {/* Threads Sidebar */}
            <div className="border-r border-border flex flex-col h-full min-h-0 overflow-hidden">
              <div className="shrink-0 border-b border-border p-3 space-y-2">
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
              <div className="divide-y divide-border overflow-y-auto flex-1 min-h-0">
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
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="shrink-0 flex items-center justify-between border-b border-border p-3.5">
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
                      className="h-7 text-xs bg-primary text-primary-foreground font-semibold gap-1.5 shadow-xs"
                    >
                      {isGeneratingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      {isGeneratingDraft ? "Generating…" : "Generate Draft"}
                    </Button>
                    <Badge variant="outline" className="gap-1 text-[10px]"><Linkedin className="h-3 w-3" />LinkedIn</Badge>
                  </div>
                </div>

                <div className="shrink-0 border-b border-border px-4 py-2">
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">To</label>
                  <Input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="https://www.linkedin.com/in/…"
                    className="mt-0.5 h-7 text-xs"
                  />
                </div>

                {/* Center Conversation Content */}
                <div className="flex-1 min-h-0 space-y-3 overflow-y-auto p-4 flex flex-col justify-start">
                  {conv.messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center p-4 text-center space-y-2 min-h-0">
                      <div className="h-12 w-12 rounded-full bg-muted/20 border border-border/40 flex items-center justify-center text-muted-foreground/50">
                        <MessageCircle className="h-6 w-6 stroke-[1.5]" />
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-sm font-semibold text-foreground">No messages yet.</div>
                        <div className="text-xs text-muted-foreground">Compose a message below to start the conversation.</div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-center my-1">
                        <span className="rounded-full bg-muted/70 px-3 py-0.5 text-[11px] font-medium text-muted-foreground">
                          Today
                        </span>
                      </div>
                      {conv.messages.map((m: ApiConversationMessage) =>
                        m.sender === "ME" ? (
                          <div key={m.id} className="flex justify-end">
                            <div className="max-w-[82%] rounded-2xl border border-border/60 bg-[#24211e] p-3.5 shadow-sm space-y-1.5">
                              <div className="text-xs text-muted-foreground/80 font-medium">
                                Me • {formatMessageTime(m.sentAt)}
                              </div>
                              <div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                                {m.text}
                              </div>
                              <div className="text-[10px] text-muted-foreground/80 flex justify-end items-center gap-1 pt-0.5">
                                <span>Sent</span>
                                <span className="text-emerald-400 font-bold">✓✓</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div key={m.id} className="flex justify-start gap-2.5 items-start">
                            <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 text-primary flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5">
                              {candidateName(conv).slice(0, 2).toUpperCase()}
                            </div>
                            <div className="max-w-[82%] rounded-2xl border border-border/60 bg-[#24211e] p-3.5 shadow-sm space-y-1.5">
                              <div className="text-xs text-muted-foreground/80 font-medium">
                                {candidateName(conv)} • {formatMessageTime(m.sentAt)}
                              </div>
                              <div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                                {m.text}
                              </div>
                            </div>
                          </div>
                        )
                      )}
                    </>
                  )}
                </div>

                {/* Bottom Chat Composer Box */}
                <div className="shrink-0 p-3 pt-1 space-y-1 bg-card">
                  <div className="rounded-xl border border-amber-500/40 bg-[#1e1b18] p-3 shadow-lg focus-within:border-amber-500 transition-all space-y-2">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && draft.trim() && !sending) {
                          e.preventDefault();
                          initiateSend();
                        }
                      }}
                      placeholder="Type your message..."
                      className="min-h-[65px] max-h-[120px] resize-none border-0 bg-transparent p-0 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-0 shadow-none"
                      disabled={sending}
                    />
                    <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/30">
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <button type="button" className="hover:text-foreground transition-colors cursor-pointer" title="Add emoji">
                          <Smile className="h-4 w-4" />
                        </button>
                        <button type="button" className="hover:text-foreground transition-colors cursor-pointer" title="Attach image">
                          <ImageIcon className="h-4 w-4" />
                        </button>
                        <button type="button" className="hover:text-foreground transition-colors cursor-pointer" title="Attach file">
                          <Paperclip className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCheckFaq}
                          disabled={isCheckingFaq}
                          className="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1.5 disabled:opacity-50 cursor-pointer text-xs"
                        >
                          {isCheckingFaq ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircleQuestion className="h-3.5 w-3.5" />}
                          <span>{isCheckingFaq ? "Checking…" : "Check FAQ"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleGenerateLinkedInDraft}
                          disabled={isGeneratingDraft}
                          className="text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1.5 disabled:opacity-50 cursor-pointer ml-1 text-xs"
                        >
                          {isGeneratingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                          <span>{isGeneratingDraft ? "Generating…" : "Use Draft"}</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-[11px] ${draft.length > 3000 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                          {draft.length}/3000
                        </span>
                        <Button
                          type="button"
                          disabled={sending || !draft.trim()}
                          className="h-8 px-4 bg-[#f97316] hover:bg-[#ea580c] text-black gap-1.5 font-bold text-xs cursor-pointer shadow-md rounded-lg transition-transform active:scale-95 disabled:opacity-50"
                          onClick={initiateSend}
                        >
                          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 text-black fill-black" />}
                          <span>Send</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/70 pb-0.5">
                    <Lock className="h-3 w-3" />
                    <span>Messages will be sent via LinkedIn.</span>
                  </div>
                </div>
              </div>
            )}

            {/* Candidate Context Sidebar */}
            {conv && (
              <div className="border-l border-border p-4 overflow-y-auto min-h-0 h-full space-y-4">
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
                  <Row
                    k="Enriched Link"
                    v={
                      conv.lead?.profileLink ? (
                        <a
                          href={conv.lead.profileLink.startsWith("http") ? conv.lead.profileLink : `https://${conv.lead.profileLink}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline font-medium break-all text-[11px]"
                        >
                          View Profile ↗
                        </a>
                      ) : (
                        "N/A"
                      )
                    }
                  />
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
