import { createFileRoute } from "@tanstack/react-router";
import { PerformancePageView } from "@/components/features/performance-page-view";
import { CURRENT_CONTRACTOR_ID } from "@/lib/recruiter-mock";

export const Route = createFileRoute("/contractor/performance")({
  head: () => ({ meta: [{ title: "Lead Performance — Global3 Contractor" }] }),
  component: () => <PerformancePageView subjectId={CURRENT_CONTRACTOR_ID} roleLabel="Contractor" />,
});