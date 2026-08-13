import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ApiUser } from "@/lib/api-types";
import { Mail, Clock, Loader2 } from "lucide-react";

export const Route = createFileRoute("/recruiter/contractors")({
  head: () => ({
    meta: [
      { title: "Contractors — Global3 Recruiter" },
      { name: "description", content: "Oversee all contractors and their sourcing details." },
    ],
  }),
  component: RecruiterContractorsPage,
});

function RecruiterContractorsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["users", "CONTRACTOR"],
    queryFn: () => api.getUsers("CONTRACTOR"),
  });
  const contractors = data?.users ?? [];

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
              <ContractorCard key={c.id} c={c} />
            ))}
            {contractors.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-border p-12 text-center text-xs text-muted-foreground">
                No contractor partners onboarded yet.
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function ContractorCard({ c }: { c: ApiUser }) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:border-accent/40 hover:shadow-lg">
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
