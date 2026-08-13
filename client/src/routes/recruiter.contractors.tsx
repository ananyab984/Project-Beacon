import { createFileRoute } from "@tanstack/react-router";
import {
  useRecruiterStore,
  assignContractor,
  removeContractor,
  type AssignedContractor,
} from "@/lib/recruiter-mock";
import { Button } from "@/components/ui/button";
import { UserPlus, UserMinus, Mail, Clock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/recruiter/contractors")({
  head: () => ({
    meta: [
      { title: "Contractors — Global3 Recruiter" },
      { name: "description", content: "Oversee all contractors and their recent lead-sourcing activity." },
    ],
  }),
  component: RecruiterContractorsPage,
});

function RecruiterContractorsPage() {
  const store = useRecruiterStore();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Sourcing partners</div>
        <h2 className="mt-0.5 text-2xl font-semibold tracking-tight">Contractors</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Contractors submit leads on your behalf. Any recruiter can view any contractor's
          activity here — assign one to yourself to track their recent submissions.
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-accent">
          My contractors ({store.contractors.length})
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {store.contractors.map((c) => (
            <ContractorCard
              key={c.id}
              c={c}
              assigned
              onSecondaryAction={() => {
                removeContractor(c.id);
                toast.success(`Unassigned ${c.name}`);
              }}
            />
          ))}
          {store.contractors.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              No contractors assigned to you yet.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Available contractors ({store.unassignedContractors.length})
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {store.unassignedContractors.map((c) => (
            <ContractorCard
              key={c.id}
              c={c}
              assigned={false}
              onSecondaryAction={() => {
                assignContractor(c.id);
                toast.success(`Assigned ${c.name} to you`);
              }}
            />
          ))}
          {store.unassignedContractors.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              No unassigned contractors available right now.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ContractorCard({
  c,
  assigned,
  onSecondaryAction,
}: {
  c: AssignedContractor;
  assigned: boolean;
  onSecondaryAction: () => void;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:border-accent/40 hover:shadow-lg">
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
              {c.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                {c.name}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Mail className="h-3 w-3" /> {c.email}
              </div>
            </div>
          </div>
        </div>

        {assigned && (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/70 bg-muted/15 p-2.5 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Leads (30d)</div>
              <div className="text-sm font-bold tabular-nums">{c.leads_added_30d}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                <Clock className="h-3 w-3" /> Last active
              </div>
              <div className="text-sm font-bold">{c.last_active}</div>
            </div>
          </div>
        )}
      </div>

      <Button
        size="sm"
        variant={assigned ? "outline" : "default"}
        className={assigned ? "text-xs" : "bg-primary text-primary-foreground hover:bg-primary/90 text-xs"}
        onClick={onSecondaryAction}
      >
        {assigned ? (
          <>
            <UserMinus className="h-3.5 w-3.5" /> Unassign
          </>
        ) : (
          <>
            <UserPlus className="h-3.5 w-3.5" /> Assign to me
          </>
        )}
      </Button>
    </div>
  );
}
