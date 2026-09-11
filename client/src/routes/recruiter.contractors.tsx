import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ApiUser } from "@/lib/api-types";
import { Mail, Clock, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EvaluationDashboard } from "@/components/features/evaluation-dashboard";

export const Route = createFileRoute("/recruiter/contractors")({
  head: () => ({
    meta: [
      { title: "Contractors — Global3 Recruiter" },
      { name: "description", content: "Oversee all contractors and their sourcing details." },
    ],
  }),
  component: RecruiterContractorsPage,
});

/** ApiUser has no avatar_hue field — derive a stable per-user hue
 *  deterministically from the id, same as owner.recruiters.tsx's
 *  avatarHue, so a contractor's evaluation drawer looks consistent with
 *  the owner-facing one for the identical rubric. */
function avatarHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

function RecruiterContractorsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["users", "CONTRACTOR"],
    queryFn: () => api.getUsers("CONTRACTOR"),
  });
  const contractors = data?.users ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const active = contractors.find((c) => c.id === openId) ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Sourcing partners</div>
        <h2 className="mt-0.5 text-2xl font-semibold tracking-tight">Contractors</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Contractors submit leads across client requirements. All recruiters have oversight across all contractors.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-xs text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading contractors…
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-xs text-destructive">
          Failed to load contractors: {(error as any)?.message || "Unknown error"}
        </div>
      ) : (
        <section className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-widest text-accent">
            Contractors ({contractors.length})
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {contractors.map((c) => (
              <ContractorCard key={c.id} c={c} onOpen={() => setOpenId(c.id)} />
            ))}
            {contractors.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-border p-12 text-center text-xs text-muted-foreground">
                No contractor partners onboarded yet.
              </div>
            )}
          </div>
        </section>
      )}

      {/* Slide-out evaluation drawer -- identical rubric/scoring component the
          owner's Recruiters page uses for every recruiter and contractor
          card, so a contractor's evaluation here is the same framework, not
          a separate one. */}
      <Sheet open={!!active} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full sm:max-w-4xl overflow-auto border-l border-border bg-background p-6">
          {active && (
            <div className="space-y-6">
              <SheetHeader className="pb-4 border-b border-border">
                <SheetTitle className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-full text-base font-semibold text-white shrink-0 shadow-xs"
                    style={{ background: `oklch(0.55 0.16 ${avatarHue(active.id)})` }}
                  >
                    {active.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-lg font-bold">
                      <span>{active.name}</span>
                    </div>
                    <div className="text-xs font-normal text-muted-foreground">Contractor Evaluation</div>
                  </div>
                </SheetTitle>
              </SheetHeader>

              <EvaluationDashboard subjectId={active.id} subjectName={active.name} roleLabel="Contractor" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ContractorCard({ c, onOpen }: { c: ApiUser; onOpen: () => void }) {
  return (
    <div
      onClick={onOpen}
      className="flex cursor-pointer flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:border-accent/40 hover:shadow-lg"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
          {c.name.charAt(0)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground truncate">{c.name}</span>
            {!c.isActive && (
              <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                Inactive
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{c.email}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/15 px-3 py-2">
        <Clock className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">Joined</span>
        <span className="ml-auto text-[11px] font-semibold tabular-nums">
          {c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—"}
        </span>
      </div>
    </div>
  );
}
