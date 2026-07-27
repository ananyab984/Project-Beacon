import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Upload, Download, RefreshCw, LinkIcon, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { syncFromGoogleSheet, getSheetSyncState, setSheetUrl, addClientDemand } from "@/lib/g3-mock";

const EVENT = "g3:open-client-demand";
export const openClientDemand = () => window.dispatchEvent(new Event(EVENT));

type ServiceRow = { id: string; service: string; headcount: string };
const uid = () => Math.random().toString(36).slice(2, 9);

export function ClientDemandDialog() {
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [language, setLanguage] = useState("");
  const [services, setServices] = useState<ServiceRow[]>([{ id: uid(), service: "", headcount: "" }]);
  const [priority, setPriority] = useState("standard");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [recruiter, setRecruiter] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);

  const reset = () => {
    setClientName(""); setLanguage("");
    setServices([{ id: uid(), service: "", headcount: "" }]);
    setPriority("standard"); setContactName(""); setContactEmail(""); setRecruiter(""); setNotes("");
  };

  const addServiceRow = () => setServices(prev => [...prev, { id: uid(), service: "", headcount: "" }]);
  const removeServiceRow = (id: string) =>
    setServices(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev);
  const updateServiceRow = (id: string, patch: Partial<ServiceRow>) =>
    setServices(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

  const submit = () => {
    const cleaned = services
      .map(r => ({ ...r, service: r.service.trim() }))
      .filter(r => r.service);
    if (!clientName.trim() || !language.trim() || cleaned.length === 0) {
      toast.error("Client name, language, and at least one service are required.");
      return;
    }
    const names = cleaned.map(r => r.service.toLowerCase());
    if (new Set(names).size !== names.length) {
      toast.error("Duplicate services — each service must be unique.");
      return;
    }
    const bad = cleaned.find(r => !r.headcount || Number(r.headcount) < 1);
    if (bad) {
      toast.error(`Enter a headcount for "${bad.service}".`);
      return;
    }
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      toast.error("Enter a valid contact email or leave it empty.");
      return;
    }
    const totalSeats = cleaned.reduce((s, r) => s + Number(r.headcount), 0);

    addClientDemand({
      client: clientName.trim(),
      language: language.trim(),
      services: cleaned.map((r) => r.service),
      headcount_needed: totalSeats,
      filled: 0,
      gap: totalSeats,
      recruiter_id: recruiter.trim() ? "r1" : "unassigned",
      service_breakdown: cleaned.map((r) => ({
        service: r.service,
        needed: Number(r.headcount),
        filled: 0,
        gap: Number(r.headcount),
      })),
      priority: priority as "standard" | "high" | "critical",
      status: "active",
      contact_name: contactName.trim() || undefined,
      contact_email: contactEmail.trim() || undefined,
      notes: notes.trim() || undefined,
    });

    toast.success(`Demand added: ${clientName} — ${language} · ${cleaned.length} service${cleaned.length > 1 ? "" : "s"}, ${totalSeats} seats`);
    reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); setOpen(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Client Demand</DialogTitle>
          <DialogDescription>
            Register a new client requirement. Add each service this client needs under the language, along with the headcount required per service.
          </DialogDescription>
        </DialogHeader>

        <BulkImportStrip />
        <GoogleSheetSyncStrip />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Client name" required>
            <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Netflix" maxLength={100} />
          </Field>
          <Field label="Primary contact">
            <Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Name" maxLength={100} />
          </Field>
          <Field label="Contact email">
            <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="name@client.com" maxLength={255} />
          </Field>
          <Field label="Priority">
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Language" required className="sm:col-span-2">
            <Input value={language} onChange={e => setLanguage(e.target.value)} placeholder="e.g. Spanish (LatAm)" maxLength={60} />
          </Field>

          <div className="sm:col-span-2">
            <div className="flex items-end justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Services &amp; headcount <span className="text-primary">*</span>
              </Label>
              <Button type="button" variant="ghost" size="sm" onClick={addServiceRow} className="h-7 gap-1 text-xs">
                <Plus className="h-3.5 w-3.5" /> Add service
              </Button>
            </div>
            <div className="mt-2 space-y-2">
              {services.map((row, i) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Input
                    value={row.service}
                    onChange={e => updateServiceRow(row.id, { service: e.target.value })}
                    placeholder={i === 0 ? "e.g. Subtitling, Localization QA, AI Post-editing…" : "Service name"}
                    maxLength={60}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={9999}
                    value={row.headcount}
                    onChange={e => updateServiceRow(row.id, { headcount: e.target.value })}
                    placeholder="Headcount"
                    className="w-32"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeServiceRow(row.id)}
                    disabled={services.length === 1}
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    aria-label="Remove service"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Add any service the client needs for {language || "this language"} — no fixed catalogue. Headcount is captured per service so the staffing breakdown reflects real demand.
            </p>
          </div>

          <Field label="Assign recruiter" className="sm:col-span-2">
            <Input value={recruiter} onChange={e => setRecruiter(e.target.value)} placeholder="Recruiter name (optional)" maxLength={80} />
          </Field>

          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Contract terms, exclusivity, timelines…" rows={3} maxLength={1000} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Add Demand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, required, children, className }: { label: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}{required && <span className="text-primary"> *</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function BulkImportStrip() {
  const inputRef = useRef<HTMLInputElement>(null);
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const rows = text.split(/\r?\n/).filter(Boolean);
      const dataRows = Math.max(0, rows.length - 1);
      toast.success(`Parsed ${dataRows} client${dataRows === 1 ? "" : "s"} from ${f.name}`);
    };
    reader.onerror = () => toast.error("Could not read the file.");
    reader.readAsText(f);
    e.target.value = "";
  };
  const downloadTemplate = () => {
    const csv = "client_name,contact_name,contact_email,priority,language,service,headcount,notes\nNetflix,Ava Chen,ava@netflix.com,high,Spanish (LatAm),Subtitling,8,Q1 launch\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "clients-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2">
      <div>
        <div className="text-xs font-medium text-foreground">Bulk import</div>
        <div className="text-[11px] text-muted-foreground">Upload CSV to add multiple clients at once.</div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate} className="h-7 gap-1 text-xs">
          <Download className="h-3.5 w-3.5" /> Template
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} className="h-7 gap-1 text-xs">
          <Upload className="h-3.5 w-3.5" /> Import CSV
        </Button>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
      </div>
    </div>
  );
}

function GoogleSheetSyncStrip() {
  const [localUrl, setLocalUrl] = useState(() => getSheetSyncState().sheetUrl);
  const [lastSynced, setLastSynced] = useState<Date | null>(() => getSheetSyncState().lastSynced);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState(false);

  const handleSync = async () => {
    const urlToSync = localUrl.trim();
    if (!urlToSync) {
      toast.error("Enter a Google Sheet URL first.");
      setEditing(true);
      return;
    }
    setSheetUrl(urlToSync);
    setSyncing(true);
    try {
      const { added, updated } = await syncFromGoogleSheet(urlToSync);
      setLastSynced(new Date());
      setEditing(false);
      toast.success(`Synced from Google Sheet — ${added} added, ${updated} updated.`);
    } catch {
      toast.error("Sync failed. Check the Sheet URL and try again.");
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveUrl = () => {
    setSheetUrl(localUrl.trim());
    setEditing(false);
    toast.success("Google Sheet URL saved.");
  };

  const syncedLabel = lastSynced
    ? `Last synced ${lastSynced.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Not yet synced";

  return (
    <div className="rounded-lg border border-dashed border-accent/40 bg-accent/5 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LinkIcon className="h-3.5 w-3.5 text-accent shrink-0" />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground">Google Sheet Sync</span>
              {lastSynced && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  <CheckCircle2 className="h-2.5 w-2.5" /> Live
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">{syncedLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => setEditing((e) => !e)}
            className="h-7 gap-1 text-xs"
          >
            {editing ? "Cancel" : "Configure"}
          </Button>
          <Button
            type="button" variant="outline" size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="h-7 gap-1 text-xs"
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {syncing ? "Syncing…" : "Sync Now"}
          </Button>
        </div>
      </div>

      {/* Visual Data Flow Diagram */}
      <div className="mt-2.5 flex items-center justify-between rounded-md border border-accent/20 bg-background/70 px-2.5 py-1.5 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5 font-medium">
          <span className="rounded bg-accent/15 px-1.5 py-0.5 font-semibold text-accent">Google Form</span>
          <span>→</span>
          <span className="rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">Google Sheet</span>
          <span>→</span>
          <span className="rounded bg-accent/15 px-1.5 py-0.5 font-semibold text-accent">Dashboard Sync</span>
        </div>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
        A single intake Google Form is reused across clients &amp; projects. Responses store in a linked Google Sheet and auto-sync to update existing records &amp; add new client demands.
      </div>

      {editing && (
        <div className="mt-2.5 flex gap-2">
          <Input
            value={localUrl}
            onChange={(e) => setLocalUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            className="h-8 flex-1 text-xs"
          />
          <Button type="button" size="sm" onClick={handleSaveUrl} className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90">
            Save
          </Button>
        </div>
      )}
    </div>
  );
}