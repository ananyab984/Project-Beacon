import { createFileRoute } from "@tanstack/react-router";
import { EmailQueuePageView } from "@/components/features/email-queue-page-view";

export const Route = createFileRoute("/owner/email-queue")({
  head: () => ({ meta: [{ title: "Email Queue — Global3 Owner Console" }] }),
  component: EmailQueuePageView,
});
