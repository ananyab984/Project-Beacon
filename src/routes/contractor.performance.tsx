import { createFileRoute } from "@tanstack/react-router";
import { PerformancePage } from "./recruiter.performance";
import { CURRENT_CONTRACTOR_ID } from "@/lib/recruiter-mock";

export const Route = createFileRoute("/contractor/performance")({
  head: () => ({ meta: [{ title: "Lead Performance — Global3 Contractor" }] }),
  component: () => <PerformancePage subjectId={CURRENT_CONTRACTOR_ID} roleLabel="Contractor" />,
});