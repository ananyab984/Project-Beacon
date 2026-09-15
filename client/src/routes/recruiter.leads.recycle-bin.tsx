import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Trash2 } from "lucide-react";
import { RecycleBinList } from "@/components/features/recycle-bin-list";

export const Route = createFileRoute("/recruiter/leads/recycle-bin")({
  head: () => ({
    meta: [
      { title: "Recycle Bin — Global3 Recruiter" },
      {
        name: "description",
        content: "Deleted leads awaiting restore before their 30-day purge window closes.",
      },
    ],
  }),
  component: RecycleBinPage,
});

function RecycleBinPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        to="/recruiter/leads"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to leads
      </Link>

      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Trash2 className="h-4 w-4 text-muted-foreground" /> Recycle Bin
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deleted leads stay here for 30 days from their own deletion date, then are permanently removed. Restore any of them before then.
        </p>
      </div>

      <RecycleBinList />
    </div>
  );
}
