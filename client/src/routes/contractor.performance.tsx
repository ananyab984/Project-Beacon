import { createFileRoute } from "@tanstack/react-router";
import { PerformancePageView } from "@/components/features/performance-page-view";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/contractor/performance")({
  head: () => ({ meta: [{ title: "Lead Performance — Global3 Contractor" }] }),
  component: ContractorPerformanceRoute,
});

function ContractorPerformanceRoute() {
  const { user } = useAuth();
  if (!user) return null;
  return <PerformancePageView subjectId={user.id} roleLabel="Contractor" />;
}
