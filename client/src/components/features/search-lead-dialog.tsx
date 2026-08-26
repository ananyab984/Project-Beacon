import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Sparkles, Loader2, ContactRound, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { ApiLead } from "@/lib/api-types";

interface SearchLeadDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  onSelectLead: (lead: ApiLead) => Promise<void> | void;
  title?: string;
  description?: string;
  /** Conversations page only: hide non-LinkedIn leads entirely rather than
   *  letting them get picked and hit the server's LEAD_NOT_LINKEDIN 400 --
   *  the server check remains the real source of truth, this just avoids
   *  most recruiters ever seeing that error in the first place. */
  requireLinkedIn?: boolean;
}

export function SearchLeadDialog({
  open: controlledOpen,
  onOpenChange,
  trigger,
  onSelectLead,
  title = "Search & Add Lead",
  description = "Search leads by name or email. Selected lead will be added with enriched profile data auto-prefilled.",
  requireLinkedIn = false,
}: SearchLeadDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = onOpenChange || setInternalOpen;

  const [query, setQuery] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["leads"],
    queryFn: () => api.getLeads({ limit: 100 }),
    enabled: isOpen,
  });

  const leads = data?.leads ?? [];
  const eligibleLeads = requireLinkedIn
    ? leads.filter((l) => l.source === "LINKEDIN" && !!l.profileLink && /linkedin\.com/i.test(l.profileLink))
    : leads;

  const filtered = eligibleLeads.filter((l) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const name = (l.fullName || l.displayName || "").toLowerCase();
    const email = (l.email || "").toLowerCase();
    const country = (l.country || "").toLowerCase();
    return name.includes(q) || email.includes(q) || country.includes(q);
  });

  const handlePick = async (lead: ApiLead) => {
    setLoadingId(lead.id);
    try {
      await onSelectLead(lead);
      setIsOpen(false);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ContactRound className="h-5 w-5 text-primary" /> {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search leads by name, email, or country..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>

          {/* Leads List showing Lead Name and Enriched Status */}
          <div className="max-h-72 overflow-y-auto divide-y divide-border rounded-xl border border-border bg-card">
            {isLoading ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading leads roster…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No leads matched your search query.
              </div>
            ) : (
              filtered.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between p-3 transition-colors hover:bg-muted/30"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground truncate">
                        {l.fullName || l.displayName || "Unknown Candidate"}
                      </span>
                      {/* Enriched Status Badge */}
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1.5 py-0 font-medium ${
                          l.enrichmentStatus === "COMPLETE"
                            ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/5"
                            : l.enrichmentStatus === "PENDING"
                            ? "border-amber-500/40 text-amber-500 bg-amber-500/5"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {l.enrichmentStatus === "COMPLETE" ? (
                          <span className="flex items-center gap-1">
                            <Sparkles className="h-2.5 w-2.5" /> Enriched
                          </span>
                        ) : (
                          `Enrichment: ${l.enrichmentStatus}`
                        )}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {l.email && <span className="truncate max-w-[180px]">{l.email}</span>}
                      {l.country && <span>• {l.country}</span>}
                      {l.services?.length > 0 && <span>• {l.services.join(", ")}</span>}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    disabled={loadingId === l.id}
                    onClick={() => handlePick(l)}
                    className="ml-3 h-8 text-xs bg-primary text-primary-foreground font-semibold gap-1 shrink-0"
                  >
                    {loadingId === l.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5" /> Select Lead
                      </>
                    )}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
