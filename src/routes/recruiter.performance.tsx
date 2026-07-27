import { createFileRoute } from "@tanstack/react-router";
import { PerformancePageView } from "@/components/g3/performance-page-view";

export const Route = createFileRoute("/recruiter/performance")({
  head: () => ({ meta: [{ title: "Recruiter Performance — Global3 Recruiter" }] }),
  component: PerformancePageView,
});