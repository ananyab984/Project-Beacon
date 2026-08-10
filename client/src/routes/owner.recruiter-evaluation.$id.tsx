import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { recruiters } from "@/lib/g3-mock";
import { EvaluationDashboard } from "@/components/features/evaluation-dashboard";

export const Route = createFileRoute("/owner/recruiter-evaluation/$id")({
  head: () => ({
    meta: [
      { title: "Recruiter Evaluation — Global3" },
      { name: "description", content: "Full rubric-based performance evaluation for an individual recruiter." },
    ],
  }),
  component: RecruiterEvaluationPage,
});

function RecruiterEvaluationPage() {
  const { id } = Route.useParams();
  const r = recruiters.find((x) => x.id === id);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link
        to="/owner/recruiters"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to recruiters
      </Link>

      {r ? (
        <EvaluationDashboard
          subjectId={r.id}
          subjectName={r.name}
          roleLabel={r.role === "contractor" ? "Contractor" : "Recruiter"}
        />
      ) : (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="text-lg font-semibold">Recruiter not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">No recruiter exists with the id “{id}”.</p>
        </div>
      )}
    </div>
  );
}