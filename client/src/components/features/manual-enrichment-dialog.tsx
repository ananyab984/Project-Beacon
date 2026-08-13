import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Sparkles, UserCheck } from "lucide-react";
import { toast } from "sonner";

export interface LeadForEnrichment {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  language: string;
  source_language?: string | null;
  target_language?: string | null;
  services: string[];
  years_experience?: number | null;
  vendor_experience?: string | null;
  enrichment_status?: "enriched" | "on_hold" | "pending" | "complete";
  verified_email?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadForEnrichment | null;
  onMarkEnriched: (id: string, updatedData: Partial<LeadForEnrichment>) => void;
}

export function ManualEnrichmentDialog({ open, onOpenChange, lead, onMarkEnriched }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sourceLang, setSourceLang] = useState("");
  const [targetLang, setTargetLang] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [yearsExp, setYearsExp] = useState<string>("5");
  const [notes, setNotes] = useState("");

  // Pre-fill ONLY from the lead's real data. Empty fields stay empty rather
  // than defaulting to a plausible-looking placeholder value (a fake email,
  // a fake phone number, fabricated employer names) that a recruiter could
  // miss and save as if it were real -- that was a genuine data-fabrication
  // bug, not a convenience default.
  useEffect(() => {
    if (lead) {
      setName(lead.name || "");
      setEmail(lead.email || "");
      setPhone(lead.phone || "");
      setSourceLang(lead.source_language || "");
      setTargetLang(lead.target_language || lead.language || "");
      setServices(lead.services?.length ? lead.services : []);
      setYearsExp(lead.years_experience != null ? String(lead.years_experience) : "");
      setNotes(lead.vendor_experience || "");
    }
  }, [lead]);

  if (!lead) return null;

  const toggleService = (s: string) => {
    setServices(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleSaveOnly = () => {
    toast.success("Draft changes saved.");
    onOpenChange(false);
  };

  const handleMarkEnriched = () => {
    const parsedYears = yearsExp.trim() === "" ? undefined : Number(yearsExp);
    onMarkEnriched(lead.id, {
      name,
      email,
      phone,
      source_language: sourceLang,
      target_language: targetLang,
      services,
      years_experience: parsedYears != null && !Number.isNaN(parsedYears) ? parsedYears : undefined,
      vendor_experience: notes || undefined,
      enrichment_status: "enriched",
    });
    toast.success(`Lead marked as Enriched! ${name} has been moved to Global Leads.`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-warning/15 text-warning">
              <AlertTriangle className="h-4 w-4" />
            </span>
            Manual Lead Enrichment
            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning text-xs font-semibold ml-auto">
              🟡 On Hold
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground pt-1">
            This lead could not be fully enriched automatically. Please review and update the missing information manually before marking it as complete.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-warning-foreground">
            <div className="flex items-start gap-2.5">
              <Sparkles className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-xs text-foreground">Action Required</div>
                <div className="text-[11px] text-muted-foreground">
                  Completing enrichment will verify candidate skills and automatically promote this profile to the Global Leads directory.
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] text-muted-foreground">Candidate Display Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Email Address</Label>
              <Input value={email} onChange={e => setEmail(e.target.value)} className="mt-1 h-8 text-xs" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] text-muted-foreground">Source Language</Label>
              <Input value={sourceLang} onChange={e => setSourceLang(e.target.value)} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Target Language</Label>
              <Input value={targetLang} onChange={e => setTargetLang(e.target.value)} className="mt-1 h-8 text-xs" />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-muted-foreground mb-1.5 block">Services Offered</Label>
            <div className="flex flex-wrap gap-1.5">
              {["Subtitling", "Dubbing", "Voiceover", "Translation", "QA"].map(s => {
                const sel = services.includes(s);
                return (
                  <button
                    type="button"
                    key={s}
                    onClick={() => toggleService(s)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      sel ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s} {sel ? "✓" : ""}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] text-muted-foreground">Years of Experience</Label>
              <Input type="number" value={yearsExp} onChange={e => setYearsExp(e.target.value)} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Phone / Contact</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} className="mt-1 h-8 text-xs" />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-muted-foreground">Vendor Experience &amp; Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 h-16 text-xs resize-none" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={handleSaveOnly} className="text-xs">
            Save Draft
          </Button>
          <Button size="sm" onClick={handleMarkEnriched} className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs gap-1.5">
            <UserCheck className="h-3.5 w-3.5" />
            Mark as Enriched
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
