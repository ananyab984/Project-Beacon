import { createFileRoute } from "@tanstack/react-router";
import { PerformancePageView } from "@/components/features/performance-page-view";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/recruiter/performance")({
  head: () => ({ meta: [{ title: "Recruiter Performance — Global3 Recruiter" }] }),
  component: RecruiterPerformanceRoute,
});

function RecruiterPerformanceRoute() {
  const { user } = useAuth();
  if (!user) return null;
  return <PerformancePageView subjectId={user.id} roleLabel="Recruiter" />;
}
