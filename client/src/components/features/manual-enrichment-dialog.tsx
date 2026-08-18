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
  country?: string | null;
  profile_link?: string | null;
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
  const [country, setCountry] = useState("");
  const [profileLink, setProfileLink] = useState("");
  const [sourceLang, setSourceLang] = useState("");
  const [targetLang, setTargetLang] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [yearsExp, setYearsExp] = useState<string>("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (lead) {
      setName(lead.name || "");
      setEmail(lead.email || "");
      setPhone(lead.phone || "");
      setCountry(lead.country || "");
      setProfileLink(lead.profile_link || "");
      setSourceLang(lead.source_language || "");
      setTargetLang(lead.target_language || lead.language || "");
      setServices(lead.services?.length ? lead.services : []);
      setYearsExp(lead.years_experience != null ? String(lead.years_experience) : "");
      setNotes(lead.vendor_experience || "");
    }
  }, [lead]);

  if (!lead) return null;

  const hasContact = !!(email.trim() || phone.trim() || profileLink.trim());

  const toggleService = (s: string) => {
    setServices((prev) =>
      prev.some((x) => x.toLowerCase() === s.toLowerCase())
        ? prev.filter((x) => x.toLowerCase() !== s.toLowerCase())
        : [...prev, s]
    );
  };

  const isServiceSelected = (s: string) => {
    return services.some((x) => x.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(x.toLowerCase()));
  };

  const handleSaveOnly = () => {
    const parsedYears = yearsExp.trim() === "" ? undefined : Number(yearsExp);
    onMarkEnriched(lead.id, {
      name,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      country: country.trim() || undefined,
      profile_link: profileLink.trim() || undefined,
      source_language: sourceLang.trim() || undefined,
      target_language: targetLang.trim() || undefined,
      services,
      years_experience: parsedYears != null && !Number.isNaN(parsedYears) ? parsedYears : undefined,
      vendor_experience: notes.trim() || undefined,
      enrichment_status: hasContact ? "complete" : "pending",
    });
    toast.success("Draft changes saved.");
    onOpenChange(false);
  };

  const handleMarkEnriched = () => {
    const parsedYears = yearsExp.trim() === "" ? undefined : Number(yearsExp);
    onMarkEnriched(lead.id, {
      name,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      country: country.trim() || undefined,
      profile_link: profileLink.trim() || undefined,
      source_language: sourceLang.trim() || undefined,
      target_language: targetLang.trim() || undefined,
      services: services.length > 0 ? services : ["Subtitling"],
      years_experience: parsedYears != null && !Number.isNaN(parsedYears) ? parsedYears : undefined,
      vendor_experience: notes.trim() || undefined,
      enrichment_status: "complete",
    });
    toast.success(`Lead marked as Enriched! ${name} has been promoted.`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className={`grid h-7 w-7 place-items-center rounded-lg ${hasContact ? "bg-accent/15 text-accent" : "bg-warning/15 text-warning"}`}>
              {hasContact ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </span>
            Manual Lead Enrichment
            <Badge
              variant="outline"
              className={`text-xs font-semibold ml-auto ${
                hasContact
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-warning/40 bg-warning/10 text-warning"
              }`}
            >
              {hasContact ? "🟢 Ready to Enrich" : "🟡 On Hold"}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground pt-1">
            Review and update candidate skills, contact info, and language pair to promote this lead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-primary-foreground">
            <div className="flex items-start gap-2.5">
              <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-xs text-foreground">
                  {hasContact ? "Candidate details detected" : "Action Required"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Marking as enriched will verify candidate skills and automatically populate the Email Queue and LinkedIn conversations.
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] text-muted-foreground">Candidate Display Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Email Address</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="mt-1 h-8 text-xs" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] text-muted-foreground">Phone / Contact</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 234 567 8900" className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Country</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. India, United States" className="mt-1 h-8 text-xs" />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-muted-foreground">LinkedIn / Profile Link</Label>
            <Input value={profileLink} onChange={(e) => setProfileLink(e.target.value)} placeholder="https://www.linkedin.com/in/..." className="mt-1 h-8 text-xs" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] text-muted-foreground">Source Language</Label>
              <Input value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} placeholder="e.g. English" className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Target Language</Label>
              <Input value={targetLang} onChange={(e) => setTargetLang(e.target.value)} placeholder="e.g. German, Hindi" className="mt-1 h-8 text-xs" />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-muted-foreground mb-1.5 block">Services Offered</Label>
            <div className="flex flex-wrap gap-1.5">
              {["Subtitling", "Dubbing", "Voiceover", "Translation", "QA", "Audio Description", "SDH"].map((s) => {
                const sel = isServiceSelected(s);
                return (
                  <button
                    type="button"
                    key={s}
                    onClick={() => toggleService(s)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      sel
                        ? "border-primary bg-primary/10 font-semibold text-primary"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
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
              <Input type="number" value={yearsExp} onChange={(e) => setYearsExp(e.target.value)} placeholder="e.g. 5" className="mt-1 h-8 text-xs" />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-muted-foreground">Vendor Experience &amp; Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Client history, rate info, notes..." className="mt-1 h-16 text-xs resize-none" />
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
