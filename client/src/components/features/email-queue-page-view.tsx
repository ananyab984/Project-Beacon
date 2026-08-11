import { useEffect, useRef, useState } from "react";
import { useEmailQueueStore } from "@/stores/useEmailQueueStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Sparkles, Send, Trash2, RefreshCw, Save, CircleDot, CheckCircle2, Loader2, Wand2 } from "lucide-react";
import { useAiToolsEnabled } from "@/hooks/use-ai-tools";
import { toast } from "sonner";
import { FEATURES } from "@/lib/feature-flags";

export function generateEmailDraft(name: string, language: string = "Linguist") {
  return `Hi ${name},\n\nI hope this email finds you well.\n\nI'm reaching out from the Resource Management team at Global3. We recently reviewed your profile and believe your expertise would be a strong asset to our current and upcoming project pipelines.\n\nWe are actively looking to connect with talented freelance ${language} linguists who value long-term, meaningful collaboration over one-off tasks.\n\nAt Global3, we pride ourselves on building lasting partnerships with our global network of professionals. You can find more details about our mission and the scope of our work at global3.io.\n\nIf you are open to exploring a partnership, please submit your application through our portal so we can align your profile with relevant opportunities: https://app.global3.io/apply\n\nShould you have any questions before applying, please feel free to reach out to us at resources@global3.io. We're happy to provide more information.\n\nBest regards,\nResources Team`;
}

export function generateLinkedInDraft(name: string, language: string = "Linguist") {
  return `Hi ${name},\n\nWe're urgently looking for a freelance Native ${language} to join us at Global3. For more information about our team and services, please visit global3.io.\n\nIf you're interested in this opportunity, you can apply through our application form here: https://app.global3.io/apply`;
}

export function EmailQueuePageView() {
  const { emailQueue, updateDraft, approveAndSendDraft } = useEmailQueueStore();
  const [selectedId, setSelectedId] = useState(emailQueue[0]?.id);
  const selected = emailQueue.find((e) => e.id === selectedId) ?? emailQueue[0];
  const [aiPref] = useAiToolsEnabled();
  const ai = FEATURES.ai && aiPref;
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState(selected ? `Global3 Outreach · Freelance Partnership (${selected.candidate_name})` : "");
  const [to, setTo] = useState(selected ? mockEmail(selected.candidate_name) : "");
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const autosaveTimer = useRef<number | null>(null);

  function pick(id: string) {
    setSelectedId(id);
    const e = emailQueue.find((x) => x.id === id);
    setBody(e?.body || "");
    setSubject(e ? `Global3 Outreach · Freelance Partnership (${e.candidate_name})` : "");
    setTo(e ? mockEmail(e.candidate_name) : "");
    setSaveState("idle");
    setSavedAt(null);
  }

  function handleGenerateDraft() {
    if (!selected) return;
    const generated = generateEmailDraft(selected.candidate_name, selected.candidate_role || "Linguist");
    setBody(generated);
    setSubject(`Global3 Outreach · Freelance Partnership (${selected.candidate_name})`);
    markDirty();
    toast.success(`Generated official email draft for ${selected.candidate_name}!`);
  }

  function markDirty() {
    setSaveState("dirty");
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(saveDraft, 1500);
  }

  function saveDraft() {
    setSaveState("saving");
    window.setTimeout(() => {
      setSaveState("saved");
      setSavedAt(new Date());
    }, 500);
  }

  useEffect(() => () => { if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current); }, []);

  return (
    <div className="mx-auto h-[calc(100vh-8rem)] max-w-7xl overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid h-full grid-cols-1 md:grid-cols-[340px_1fr]">
        <div className="border-r border-border">
          <div className="border-b border-border p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Queue <span className="text-muted-foreground font-normal">({emailQueue.length})</span></div>
              <Badge variant="outline" className="text-[10px]">All Statuses</Badge>
            </div>
          </div>
          <div className="divide-y divide-border overflow-y-auto">
            {emailQueue.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No items in queue.
              </div>
            )}
            {emailQueue.map((e) => (
              <button key={e.id} onClick={() => pick(e.id)} className={`block w-full p-3 text-left transition-colors ${selected?.id === e.id ? "bg-muted/60" : "hover:bg-muted/30"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{e.candidate_name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{e.candidate_role}</div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{e.received_ago}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <Badge variant="outline" className={`text-[9px] ${statusTone(e.status)}`}>{e.status}</Badge>
                  {e.ai_generated && ai && <Badge className="bg-primary/15 text-primary border-0 text-[9px] gap-1"><Sparkles className="h-2.5 w-2.5" />AI</Badge>}
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground/80">{e.preview}</div>
              </button>
            ))}
          </div>
        </div>

        {selected && (
          <div className="flex h-full flex-col">
            <div className="border-b border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{selected.candidate_name}</div>
                  <div className="text-xs text-muted-foreground">{selected.candidate_role}</div>
                  <SaveStatus state={saveState} savedAt={savedAt} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={handleGenerateDraft}
                    className="h-8 text-xs bg-primary text-primary-foreground font-semibold gap-1.5 shadow-xs"
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Generate Draft
                  </Button>
                  <Button variant="outline" size="sm" onClick={saveDraft} className="h-8 text-xs"><Save className="h-3.5 w-3.5" />Save draft</Button>
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive"><Trash2 className="h-3.5 w-3.5" />Discard</Button>
                  <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => toast.success("Email sent")}><Send className="h-3.5 w-3.5" />Send</Button>
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">To</label>
                <Input value={to} onChange={(e) => { setTo(e.target.value); markDirty(); }} placeholder="recipient@example.com" className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Subject</label>
                <Input value={subject} onChange={(e) => { setSubject(e.target.value); markDirty(); }} className="mt-1" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Email Body</label>
                  <button
                    onClick={handleGenerateDraft}
                    className="text-[11px] text-accent hover:underline font-medium flex items-center gap-1"
                  >
                    <Wand2 className="h-3 w-3" /> Insert Official Template
                  </button>
                </div>
                <Textarea
                  value={body}
                  onChange={(e) => { setBody(e.target.value); markDirty(); }}
                  placeholder="Click 'Generate Draft' button above to generate official email outreach message..."
                  className="mt-1 min-h-[320px] font-sans text-xs leading-relaxed"
                />
              </div>
            </div>
          </div>
        )}
      </div>
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

function mockEmail(name: string) {
  return name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "") + "@example.com";
}

function statusTone(s: string) {
  if (s === "AI Drafted") return "border-primary/40 text-primary";
  if (s === "Follow-up") return "border-accent/40 text-accent";
  return "border-warning/40 text-warning";
}
