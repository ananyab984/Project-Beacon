import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useRecruiterStore } from "@/lib/recruiter-mock";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Sparkles, Send, Trash2, RefreshCw, Save, CircleDot, CheckCircle2, Loader2 } from "lucide-react";
import { useAiToolsEnabled } from "@/hooks/use-ai-tools";
import { toast } from "sonner";
import { FEATURES } from "@/lib/feature-flags";

export const Route = createFileRoute("/recruiter/email-queue")({
  head: () => ({ meta: [{ title: "Email Queue — Global3 Recruiter" }] }),
  component: EmailQueuePage,
});

export function EmailQueuePage() {
  const store = useRecruiterStore();
  const [selectedId, setSelectedId] = useState(store.emailQueue[0]?.id);
  const selected = store.emailQueue.find((e) => e.id === selectedId) ?? store.emailQueue[0];
  const [aiPref] = useAiToolsEnabled();
  const ai = FEATURES.ai && aiPref;
  const [body, setBody] = useState(selected?.body ?? "");
  const [subject, setSubject] = useState(selected?.subject ?? "");
  const [to, setTo] = useState(selected ? mockEmail(selected.candidate_name) : "");
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const autosaveTimer = useRef<number | null>(null);

  function pick(id: string) {
    setSelectedId(id);
    const e = store.emailQueue.find((x) => x.id === id);
    setBody(e?.body ?? "");
    setSubject(e?.subject ?? "");
    setTo(e ? mockEmail(e.candidate_name) : "");
    setSaveState("idle");
    setSavedAt(null);
  }

  function markDirty() {
    setSaveState("dirty");
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(saveDraft, 1500);
  }

  function saveDraft() {
    setSaveState("saving");
    // Simulated persist — in a real app, PATCH the draft on the store.
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
              <div className="text-sm font-semibold">Queue <span className="text-muted-foreground font-normal">({store.emailQueue.length})</span></div>
              <Badge variant="outline" className="text-[10px]">All Statuses</Badge>
            </div>
          </div>
          <div className="divide-y divide-border overflow-y-auto">
            {store.emailQueue.map((e) => (
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
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-semibold">{selected.candidate_name}</div>
                  <div className="text-xs text-muted-foreground">{selected.candidate_role}</div>
                  <SaveStatus state={saveState} savedAt={savedAt} />
                </div>
                <div className="flex gap-2">
                  {selected.ai_generated && ai && (
                    <Button variant="outline" size="sm" onClick={() => toast("Regenerating draft…")}><RefreshCw className="h-3.5 w-3.5" />Regenerate</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={saveDraft}><Save className="h-3.5 w-3.5" />Save draft</Button>
                  <Button variant="ghost" size="sm" className="text-destructive"><Trash2 className="h-3.5 w-3.5" />Discard</Button>
                  <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => toast.success("Email sent")}><Send className="h-3.5 w-3.5" />Send</Button>
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground">To</label>
                <Input value={to} onChange={(e) => { setTo(e.target.value); markDirty(); }} placeholder="recipient@example.com" className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Subject</label>
                <Input value={subject} onChange={(e) => { setSubject(e.target.value); markDirty(); }} className="mt-1" />
              </div>
              <div className="flex-1">
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Body</label>
                <Textarea value={body} onChange={(e) => { setBody(e.target.value); markDirty(); }} className="mt-1 min-h-[320px] font-[13px] leading-relaxed" />
              </div>
              {selected.ai_generated && ai && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-[11px] text-primary/90">
                  <div className="flex items-center gap-2 font-semibold"><Sparkles className="h-3 w-3" />AI Drafted</div>
                  <p className="mt-1 text-muted-foreground">Review before sending. Personalization based on candidate profile.</p>
                </div>
              )}
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