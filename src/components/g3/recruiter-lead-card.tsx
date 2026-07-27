import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Mail, Link2, Phone, MapPin, Calendar } from "lucide-react";
import type { RecruiterLead } from "@/lib/recruiter-mock";

function isJustEnriched(l: RecruiterLead) {
  return !!l.just_enriched_until && l.just_enriched_until > Date.now();
}

export function LeadDetailSheet({ lead, open, onOpenChange }: { lead: RecruiterLead | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {lead && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {lead.full_name}
                {isJustEnriched(lead) && (
                  <Badge className="bg-primary/15 text-primary border-0 gap-1">
                    <Sparkles className="h-3 w-3" /> Just enriched
                  </Badge>
                )}
              </SheetTitle>
            </SheetHeader>

            <Section title="Capture">
              <Row icon={<MapPin className="h-3.5 w-3.5" />} label="Country" value={lead.country_of_residence || "—"} />
              <Row icon={<Link2 className="h-3.5 w-3.5" />} label="Source" value={lead.source} />
              <Row icon={<Link2 className="h-3.5 w-3.5" />} label="Profile Link" value={lead.profile_link || "—"} />
              <Row icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={lead.email_address || "—"} />
              <Row icon={<Phone className="h-3.5 w-3.5" />} label="Contact" value={lead.contact_number || "—"} />
              <Row icon={<Calendar className="h-3.5 w-3.5" />} label="Reachout Date" value={lead.reachout_date || "—"} />
              <Row icon={<Calendar className="h-3.5 w-3.5" />} label="Application Date" value={lead.application_date || "—"} />
            </Section>

            <Section title={lead.enrichment_status === "pending" ? "Enriching…" : "Enriched"}>
              {lead.enrichment_status === "pending" ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : (
                <>
                  <Row label="Services" value={<div className="flex flex-wrap gap-1">{lead.services?.map((s) => <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>)}</div>} />
                  <Row label="Source Language" value={lead.source_language ?? "—"} />
                  <Row label="Target Language" value={lead.target_language ?? "—"} />
                  <Row label="Secondary Languages" value={lead.secondary_languages?.join(", ") || "—"} />
                  <Row label="Years of Exp." value={lead.years_of_exp?.toString() ?? "—"} />
                  <Row label="Vendor Experience" value={lead.vendor_experience ?? "—"} />
                </>
              )}
            </Section>

            <div className="mt-6 rounded-lg border border-dashed border-border/60 bg-muted/20 p-4">
              <div className="text-xs font-semibold text-muted-foreground">Status (pending schema)</div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Stage, availability and DNC fields aren't in this schema version. Placeholder pending confirmation.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className="mb-2 text-[11px] uppercase tracking-widest text-muted-foreground">{title}</div>
      <div className="rounded-lg border border-border bg-card p-3 space-y-2">{children}</div>
    </div>
  );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-3 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}{label}</div>
      <div className="text-foreground/90 break-all">{value}</div>
    </div>
  );
}

export { isJustEnriched };