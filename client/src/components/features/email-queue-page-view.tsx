import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEmailQueueStore } from "@/stores/useEmailQueueStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Sparkles, Send, RefreshCw, Save, CircleDot, CheckCircle2, Loader2, Wand2, Plus, Search, Mail, MessageCircleQuestion } from "lucide-react";
import { useAiToolsEnabled } from "@/hooks/use-ai-tools";
import { toast } from "sonner";
import { FEATURES } from "@/lib/feature-flags";

import { api } from "@/lib/api";
import { checkFaqAndAutofill } from "@/lib/faq";
import type { ApiEmailQueueItem, ApiConversationMessage, EmailQueueStatus } from "@/lib/api-types";
import { ConnectAccountDialog } from "@/components/features/connect-account-dialog";
import { AddLeadDialog } from "@/components/features/add-lead-dialog";
import { SearchLeadDialog } from "@/components/features/search-lead-dialog";
import { SelectAccountDialog } from "@/components/features/select-account-dialog";

function candidateName(item: ApiEmailQueueItem): string {
  return item.candidateName || item.lead?.fullName || item.lead?.displayName || "Unknown";
}

function candidateEmail(item: ApiEmailQueueItem): string {
  return item.lead?.email || "";
}

function timeAgo(iso: string): string {
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

function preview(item: ApiEmailQueueItem): string {
  if (!item.body) return "No draft yet";
  return item.body.replace(/\s+/g, " ").trim().slice(0, 100);
}

export function EmailQueuePageView() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["email-queue"],
    queryFn: api.getEmailQueue,
    // Poll so a lead that just replied actually climbs to the top of the
    // list on its own, same cadence as EmailRepliesSection's own poll for
    // the currently-open thread.
    refetchInterval: 15_000,
  });
  const emailQueue = data?.items ?? [];

  const { data: leadsData } = useQuery({
    queryKey: ["leads"],
    queryFn: () => api.getLeads({ limit: 100 }),
  });
  const availableLeads = leadsData?.leads ?? [];

  const { isGeneratingDraft, setIsGeneratingDraft } = useEmailQueueStore();

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const selected = emailQueue.find((e) => e.id === selectedId);
  const [aiPref] = useAiToolsEnabled();
  const ai = FEATURES.ai && aiPref;
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [to, setTo] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [searchLeadQuery, setSearchLeadQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [addingLeadId, setAddingLeadId] = useState<string | null>(null);
  const [isCheckingFaq, setIsCheckingFaq] = useState(false);

  // Inbound email replies for the selected lead. Shares its query key with
  // <EmailRepliesSection /> so the two are deduped by react-query; used here to
  // find the candidate's latest message for the FAQ lookup.
  const { data: emailThread } = useQuery({
    queryKey: ["email-replies", selected?.leadId],
    queryFn: () => api.getConversationByLead(selected!.leadId, "EMAIL"),
    enabled: !!selected?.leadId,
  });

  const lastCandidateEmail = [...(emailThread?.messages ?? [])]
    .reverse()
    .find((m: ApiConversationMessage) => m.sender === "THEM")?.text;

  async function handleCheckFaqEmail() {
    await checkFaqAndAutofill(lastCandidateEmail, setIsCheckingFaq, (draft) => {
      setBody(draft);
      markDirty();
    });
  }

  // Auto-select the first item on initial load, and re-select whenever the
  // currently selected item disappears from the list (e.g. a newly-added
  // lead superseding an in-flight selection).
  useEffect(() => {
    if (emailQueue.length === 0) return;
    if (!selectedId || !emailQueue.some((e) => e.id === selectedId)) {
      pick(emailQueue[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailQueue]);

  const [selectAccountDialogOpen, setSelectAccountDialogOpen] = useState(false);
  const [targetChannelAccounts, setTargetChannelAccounts] = useState<any[]>([]);
  const [targetChannel, setTargetChannel] = useState<"EMAIL" | "LINKEDIN">("EMAIL");

  async function initiateSend() {
    if (!selected) return;
    const channel = selected.candidateRole?.toLowerCase().includes("linkedin") ? "LINKEDIN" : "EMAIL";

    try {
      const accounts = await api.getConnectedAccounts();
      const active = accounts.filter((a: any) => a.status !== "DISCONNECTED");

      const channelAccs = active.filter((a: any) => {
        const p = (a.provider || "").toUpperCase();
        if (channel === "LINKEDIN") return p.includes("LINKEDIN");
        return ["EMAIL", "GOOGLE", "MAIL", "OUTLOOK"].some((type) => p.includes(type));
      });

      if (channelAccs.length === 0) {
        toast.error(`No connected ${channel === "LINKEDIN" ? "LinkedIn" : "Email"} account found`, {
          action: { label: "Connect Account", onClick: () => setConnectDialogOpen(true) },
        });
        return;
      }

      if (channelAccs.length > 1) {
        setTargetChannelAccounts(channelAccs);
        setTargetChannel(channel);
        setSelectAccountDialogOpen(true);
        return;
      }

      // Single connected account -> send directly
      await executeSend(channelAccs[0].unipileAccountId);
    } catch (err: any) {
      toast.error(err.message || "Failed to check connected accounts");
    }
  }

  async function executeSend(accountId?: string) {
    if (!selected) return;
    setSending(true);
    try {
      const channel = selected.candidateRole?.toLowerCase().includes("linkedin") ? "LINKEDIN" : "EMAIL";
      await api.sendEmailQueueItem(selected.id, { to, subject, body, channel, accountId });
      await queryClient.invalidateQueries({ queryKey: ["email-queue"] });
      toast.success(`Message sent via Unipile to ${candidateName(selected)}!`);
      setSelectAccountDialogOpen(false);
    } catch (err: any) {
      if (err.code === "ACCOUNT_NOT_CONNECTED" || err.message?.includes("connect")) {
        toast.error("Unipile account not connected", {
          description: err.message,
          action: {
            label: "Connect Account",
            onClick: () => setConnectDialogOpen(true),
          },
        });
      } else {
        toast.error(err.message || "Failed to send message via Unipile");
      }
    } finally {
      setSending(false);
    }
  }

  function pick(id: string) {
    setSelectedId(id);
    const e = emailQueue.find((x) => x.id === id);
    setBody(e?.body || "");
    setSubject(e?.subject || (e ? `Global3 Outreach · Freelance Partnership (${candidateName(e)})` : ""));
    setTo(e ? e.to || candidateEmail(e) : "");
    setSaveState("idle");
    setSavedAt(null);
  }

  // `to` is authoritative once saved/sent (persisted on the item itself --
  // survives a later enrichment correction or unrelated re-render without
  // being silently replaced). Only a fresh item with no saved override yet
  // tracks the lead's live email, so a correction still reaches it before
  // anyone's touched the field.
  useEffect(() => {
    if (!selected || selected.to) return;
    setTo(candidateEmail(selected));
  }, [selected?.id, selected?.to, selected?.lead?.email, selected?.lead?.fullName, selected?.lead?.displayName, selected?.candidateName]);

  async function handleAddLeadToQueue(leadId: string) {
    setAddingLeadId(leadId);
    try {
      const { item } = await api.addToEmailQueue(leadId);
      await queryClient.invalidateQueries({ queryKey: ["email-queue"] });
      setSelectedId(item.id);
      setBody(item.body);
      setSubject(item.subject);
      setTo(item.to || item.lead?.email || "");
      toast.success(`Added ${item.candidateName} to Email Queue!`);
    } catch (err: any) {
      toast.error(err.message || "Failed to add lead to queue");
    } finally {
      setAddingLeadId(null);
      setSearchLeadQuery("");
    }
  }

  async function handleGenerateDraft() {
    if (!selected) return;
    setIsGeneratingDraft(true);
    try {
      // Pass along whatever the recruiter has typed into the TO field --
      // previously this was silently dropped, so a manually-entered email
      // could never unblock a NO_EMAIL-ineligible lead (the field only ever
      // reached the backend at send time, never at draft time).
      const { item } = await api.generateEmailDraft(selected.id, to.trim() || undefined);
      setBody(item.body);
      setSubject(item.subject);
      setSaveState("saved");
      setSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ["email-queue"] });
      toast.success(`Generated official email draft for ${candidateName(selected)}!`);
    } catch (err: any) {
      if (err.status === 502 || err.code === "DRAFTING_SERVICE_UNAVAILABLE") {
        toast.error("Drafting service unavailable — write the message manually");
      } else {
        toast.error(err.message || "Failed to generate draft");
      }
    } finally {
      setIsGeneratingDraft(false);
    }
  }

  function markDirty() {
    setSaveState("dirty");
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(saveDraft, 1500);
  }

  async function saveDraft() {
    if (!selected) return;
    setSaveState("saving");
    try {
      await api.updateEmailQueueItem(selected.id, { subject, body, to });
      setSaveState("saved");
      setSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ["email-queue"] });
    } catch (err: any) {
      setSaveState("dirty");
      toast.error(err.message || "Failed to save draft");
    }
  }

  useEffect(() => () => { if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current); }, []);

  return (
    <div className="mx-auto h-[calc(100vh-8rem)] max-w-7xl overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid h-full grid-cols-1 md:grid-cols-[340px_1fr]">
        <div className="border-r border-border flex flex-col h-full">
          <div className="border-b border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Queue <span className="text-muted-foreground font-normal">({emailQueue.length})</span></div>
              <div className="flex items-center gap-1.5">
                <SearchLeadDialog
                  onSelectLead={(lead) => handleAddLeadToQueue(lead.id)}
                  trigger={
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 px-2 border-border">
                      <Search className="h-3 w-3 text-primary" /> Search Lead
                    </Button>
                  }
                />
                <AddLeadDialog
                  open={addLeadOpen}
                  setOpen={setAddLeadOpen}
                  trigger={
                    <Button size="sm" className="h-7 text-xs bg-primary text-primary-foreground font-medium gap-1 px-2 shadow-xs">
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  }
                />
              </div>
            </div>
            {/* Quick search existing lead to add to queue */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search lead to add to queue…"
                value={searchLeadQuery}
                onChange={(e) => setSearchLeadQuery(e.target.value)}
                className="pl-8 h-8 text-xs bg-muted/30"
              />
              {searchLeadQuery.trim() && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
                  {availableLeads
                    .filter((l) =>
                      (l.fullName || l.displayName || "").toLowerCase().includes(searchLeadQuery.toLowerCase()) ||
                      (l.email || "").toLowerCase().includes(searchLeadQuery.toLowerCase())
                    )
                    .slice(0, 5)
                    .map((l) => (
                      <button
                        key={l.id}
                        disabled={addingLeadId === l.id}
                        onClick={() => handleAddLeadToQueue(l.id)}
                        className="w-full text-left px-2.5 py-1.5 rounded text-xs hover:bg-accent hover:text-accent-foreground flex items-center justify-between transition-colors"
                      >
                        <span className="font-medium truncate">{l.fullName || l.displayName}</span>
                        <span className="text-[10px] text-muted-foreground ml-2 shrink-0">
                          {addingLeadId === l.id ? "Adding…" : "+ Add"}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
          <div className="divide-y divide-border overflow-y-auto">
            {isLoading && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading email queue…
              </div>
            )}
            {isError && (
              <div className="p-6 text-center text-xs text-destructive">
                Failed to load email queue{(error as any)?.message ? `: ${(error as any).message}` : "."}
              </div>
            )}
            {!isLoading && !isError && emailQueue.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                <SearchLeadDialog
                  onSelectLead={(lead) => handleAddLeadToQueue(lead.id)}
                  trigger={
                    <button className="text-primary hover:underline font-medium">
                      Add leads from an existing lead to get started
                    </button>
                  }
                />
              </div>
            )}
            {emailQueue.map((e) => (
              <button key={e.id} onClick={() => pick(e.id)} className={`block w-full p-3 text-left transition-colors ${selected?.id === e.id ? "bg-muted/60" : "hover:bg-muted/30"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{candidateName(e)}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{e.candidateRole}</div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(e.receivedAt)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <Badge variant="outline" className={`text-[9px] ${statusTone(e.status)}`}>{statusLabel(e.status)}</Badge>
                  {e.aiGenerated && ai && <Badge className="bg-primary/15 text-primary border-0 text-[9px] gap-1"><Sparkles className="h-2.5 w-2.5" />AI</Badge>}
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground/80">{preview(e)}</div>
              </button>
            ))}
          </div>
        </div>

        {selected && (
          <div className="flex h-full min-h-0 min-w-0 flex-col">
            <div className="border-b border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{candidateName(selected)}</div>
                  <div className="text-xs text-muted-foreground">{selected.candidateRole}</div>
                  <SaveStatus state={saveState} savedAt={savedAt} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={saveDraft} disabled={selected.status === "SENT"} className="h-8 text-xs"><Save className="h-3.5 w-3.5" />Save draft</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckFaqEmail}
                    disabled={isCheckingFaq || !lastCandidateEmail}
                    title={lastCandidateEmail ? "Check the candidate's latest reply against the FAQ" : "No reply from the candidate yet to check"}
                    className="h-8 text-xs gap-1.5 text-cyan-500 hover:text-cyan-400"
                  >
                    {isCheckingFaq ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircleQuestion className="h-3.5 w-3.5" />}
                    {isCheckingFaq ? "Checking…" : "Check FAQ"}
                  </Button>
                  {selected.status === "SENT" ? (
                    <Badge className="h-8 gap-1.5 border-0 bg-[oklch(0.55_0.14_155)]/15 px-3 text-xs font-semibold text-[oklch(0.55_0.14_155)]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Delivered{selected.sentChannel ? ` via ${selected.sentChannel === "LINKEDIN" ? "LinkedIn" : "Email"}` : ""}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      disabled={sending}
                      className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={initiateSend}
                    >
                      {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      {sending ? "Sending via Unipile..." : "Send"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {/* One single scroll region for the whole panel -- SENT items
                used to also nest EmailRepliesSection's own capped scroll
                area inside this one, which is the "split sections" problem.
                SENT gets a Gmail-style read-only view (replies first, per
                the ask); anything still being drafted keeps the editable
                form exactly as before. */}
            <div className="flex-1 min-h-0 min-w-0 overflow-y-auto p-4 space-y-4">
              {selected.status === "SENT" ? (
                // Read straight off `selected` (the server record of what was
                // actually sent), never the editable draft state (`to`/
                // `subject`/`body` above) -- those track the in-progress
                // compose box, which can point at a different address than
                // whatever this item was actually dispatched to.
                <EmailThread leadId={selected.leadId} candidateName={candidateName(selected)} to={selected.to || candidateEmail(selected)} subject={selected.subject} body={selected.body} sentAt={selected.sentAt} />
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">To</label>
                    <Input value={to} onChange={(e) => { setTo(e.target.value); markDirty(); }} placeholder="recipient@example.com" className="mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Subject</label>
                    <Input value={subject} onChange={(e) => { setSubject(e.target.value); markDirty(); }} className="mt-1" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Email Body</label>
                    <div className="relative mt-1">
                      {!body && (
                        <div className="absolute inset-x-0 top-3 z-10 flex justify-center">
                          <Button
                            onClick={handleGenerateDraft}
                            disabled={isGeneratingDraft}
                            className="h-8 text-xs bg-primary text-primary-foreground font-semibold gap-1.5 shadow-xs"
                          >
                            {isGeneratingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                            {isGeneratingDraft ? "Generating…" : "Generate Draft"}
                          </Button>
                        </div>
                      )}
                      <Textarea
                        value={body}
                        onChange={(e) => { setBody(e.target.value); markDirty(); }}
                        placeholder={!body ? "…or start typing here to write your own." : ""}
                        className={`font-sans text-xs leading-relaxed ${!body ? "min-h-[320px] pt-14 text-center" : "min-h-[320px]"}`}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <ConnectAccountDialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen} />
      <SelectAccountDialog
        open={selectAccountDialogOpen}
        onOpenChange={setSelectAccountDialogOpen}
        accounts={targetChannelAccounts}
        channel={targetChannel}
        onSelectAccount={(accountId) => executeSend(accountId)}
        isSending={sending}
      />
    </div>
  );
}

function SaveStatus({ state, savedAt }: { state: "idle" | "dirty" | "saving" | "saved"; savedAt: Date | null }) {
  if (state === "idle") return null;
  const map = {
    dirty:  { Icon: CircleDot,     text: "Unsaved changes", cls: "text-warning" },
    saving: { Icon: Loader2,       text: "Saving…",         cls: "text-muted-foreground animate-pulse" },
    saved:  { Icon: CheckCircle2,  text: savedAt ? `Saved · ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Saved", cls: "text-[oklch(0.55_0.14_155)]" },
  } as const;
  const { Icon, text, cls } = map[state];
  return (
    <div className={`mt-1 flex items-center gap-1 text-[11px] ${cls}`}>
      <Icon className={`h-3 w-3 ${state === "saving" ? "animate-spin" : ""}`} />
      <span>{text}</span>
    </div>
  );
}

function statusLabel(s: EmailQueueStatus) {
  if (s === "AI_DRAFTED") return "AI Drafted";
  if (s === "FOLLOW_UP") return "Follow-up";
  if (s === "SENT") return "Delivered";
  return "Review Needed";
}

function statusTone(s: EmailQueueStatus) {
  if (s === "AI_DRAFTED") return "border-primary/40 text-primary";
  if (s === "FOLLOW_UP") return "border-accent/40 text-accent";
  if (s === "SENT") return "border-[oklch(0.55_0.14_155)]/40 text-[oklch(0.55_0.14_155)]";
  return "border-warning/40 text-warning";
}

function formatReplyTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type ThreadMessage = {
  id: string;
  sender: "ME" | "THEM";
  text: string;
  sentAt: string;
};

// Gmail-style collapsed thread: the sent message and every reply render as
// one chronological list, collapsed to a one-line preview by default with
// only the newest message expanded -- matching how Gmail itself collapses
// everything but the latest message in a thread. Click any row to toggle it.
function EmailThread({
  leadId, candidateName, to, subject, body, sentAt,
}: { leadId: string; candidateName: string; to: string; subject: string; body: string; sentAt: string | null }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["email-replies", leadId],
    queryFn: () => api.getConversationByLead(leadId, "EMAIL"),
    refetchInterval: 15_000, // Poll every 15s for new email replies
    enabled: !!leadId,
  });

  const allMessages: ApiConversationMessage[] = data?.messages ?? [];
  const replies: ApiConversationMessage[] = allMessages.filter((m) => m.sender === "THEM");
  const conversationId = data?.conversation?.id;

  // Every real send (the original cold-outreach email AND every later reply)
  // already lands in allMessages via syncToConversation -- rendering it
  // directly, both ME and THEM, is what keeps every reply visible instead of
  // only ever showing one hardcoded "sent" bubble frozen at the original
  // send. Fall back to the EmailQueueItem's own snapshot only for the rare
  // case where the Conversation row itself doesn't exist yet (e.g. a send
  // that hasn't finished syncing), so something still renders.
  const messages: ThreadMessage[] = (
    allMessages.length > 0
      ? allMessages.map((m) => ({ id: m.id, sender: m.sender, text: m.text, sentAt: m.sentAt }))
      : [{ id: "sent", sender: "ME" as const, text: body, sentAt: sentAt || new Date(0).toISOString() }]
  ).sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

  const latestId = messages[messages.length - 1]?.id;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(latestId ? [latestId] : []));
  // Keep the newest message expanded as new replies arrive, without
  // re-collapsing anything the recruiter already opened themselves.
  useEffect(() => {
    if (latestId) setExpandedIds((prev) => (prev.has(latestId) ? prev : new Set(prev).add(latestId)));
  }, [latestId]);

  function toggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // One reply composer open at a time (matches how Gmail itself behaves,
  // and avoids two FAQ-check calls racing for the same setDraft).
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [isCheckingFaqForReply, setIsCheckingFaqForReply] = useState(false);
  const [isSendingReply, setIsSendingReply] = useState(false);

  async function openReplyBox(message: ThreadMessage) {
    setActiveReplyId(message.id);
    setReplyDraft("");
    // Opening a specific reply's box makes the intent unambiguous (unlike
    // the header's manual "Check FAQ", which only ever guesses at the
    // latest message) -- auto-run the check against exactly this reply.
    await checkFaqAndAutofill(message.text, setIsCheckingFaqForReply, setReplyDraft);
  }

  async function sendReply() {
    if (!conversationId || !replyDraft.trim()) return;
    setIsSendingReply(true);
    try {
      // Thread the outbound reply under the specific inbound message the
      // recruiter opened the reply box from, not just "the conversation" --
      // Unipile's /emails needs the exact message id as `reply_to` to land
      // in the same Gmail thread instead of starting a new one.
      const replyToMessageId = replies.find((r) => r.id === activeReplyId)?.externalMessageId ?? undefined;
      await api.sendConversationMessage(conversationId, replyDraft.trim(), undefined, undefined, replyToMessageId);
      await queryClient.invalidateQueries({ queryKey: ["email-replies", leadId] });
      toast.success("Reply sent");
      setActiveReplyId(null);
      setReplyDraft("");
    } catch (err: any) {
      toast.error(err.message || "Failed to send reply");
    } finally {
      setIsSendingReply(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="rounded-md bg-blue-500/10 p-1">
          <Mail className="h-3.5 w-3.5 text-blue-500" />
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          Conversation
        </span>
        {replies.length > 0 && (
          <Badge variant="secondary" className="text-[9px] h-4 px-1.5 bg-blue-500/10 text-blue-500 border-0">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading conversation…
        </div>
      ) : (
        <div className="space-y-1.5">
          {messages.map((m) => {
            const expanded = expandedIds.has(m.id);
            const isMe = m.sender === "ME";
            const name = isMe ? "You" : candidateName;
            return (
              <div key={m.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(m.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(m.id); } }}
                  className={`w-full cursor-pointer rounded-xl border p-3 text-left transition-colors ${
                    isMe ? "border-border/60 bg-muted/10 hover:bg-muted/20" : "border-border/60 bg-blue-500/5 hover:bg-blue-500/10"
                  }`}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <div className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        isMe ? "bg-muted text-muted-foreground" : "bg-blue-500/20 text-blue-500"
                      }`}>
                        {name.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold text-foreground">{name}</span>
                      {!expanded && (
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
                          — {m.text.replace(/\s+/g, " ").trim() || (isMe ? `To ${to}` : "")}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{formatReplyTime(m.sentAt)}</span>
                  </div>
                  {expanded && (
                    // Stop the toggle click from swallowing a text selection
                    // (mouseup after a drag-to-select still bubbles as a
                    // click) -- and keep this text out of a native <button>,
                    // which browsers make unselectable/uncopyable by default.
                    <div className="mt-1.5 pl-6" onClick={(e) => e.stopPropagation()}>
                      {isMe && subject && <div className="mb-1 text-xs font-semibold text-foreground select-text">{subject}</div>}
                      {isMe && <div className="mb-1 text-[11px] text-muted-foreground select-text">To {to}</div>}
                      <div className="select-text whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">{m.text}</div>
                    </div>
                  )}
                </div>

                {expanded && !isMe && (
                  <div className="pl-6 pt-1.5">
                    <button
                      onClick={() => (activeReplyId === m.id ? setActiveReplyId(null) : openReplyBox(m))}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      {activeReplyId === m.id ? "Cancel" : "Reply to this message"}
                    </button>

                    {activeReplyId === m.id && (
                      <div className="mt-1.5 space-y-1.5">
                        <div className="relative">
                          <Textarea
                            value={replyDraft}
                            onChange={(e) => setReplyDraft(e.target.value)}
                            placeholder={isCheckingFaqForReply ? "Checking FAQ for a matching answer…" : "Type your reply…"}
                            className="min-h-[100px] font-sans text-xs leading-relaxed"
                            disabled={isCheckingFaqForReply}
                          />
                          {isCheckingFaqForReply && (
                            <Loader2 className="absolute right-2 top-2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => checkFaqAndAutofill(m.text, setIsCheckingFaqForReply, setReplyDraft)}
                            disabled={isCheckingFaqForReply}
                            className="text-[11px] text-cyan-500 hover:underline flex items-center gap-1"
                          >
                            <MessageCircleQuestion className="h-3 w-3" /> Re-check FAQ
                          </button>
                          <Button
                            size="sm"
                            onClick={sendReply}
                            disabled={isSendingReply || !replyDraft.trim() || !conversationId}
                            className="h-7 text-xs bg-primary text-primary-foreground gap-1.5"
                          >
                            {isSendingReply ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            {isSendingReply ? "Sending…" : "Send reply"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
