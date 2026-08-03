import { createFileRoute } from "@tanstack/react-router";
import { EmailQueuePageView } from "@/components/g3/email-queue-page-view";

export const Route = createFileRoute("/recruiter/email-queue")({
  head: () => ({ meta: [{ title: "Email Queue — Global3 Recruiter" }] }),
  component: EmailQueuePageView,
});