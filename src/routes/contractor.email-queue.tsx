import { createFileRoute } from "@tanstack/react-router";
import { EmailQueuePage } from "./recruiter.email-queue";

export const Route = createFileRoute("/contractor/email-queue")({
  head: () => ({ meta: [{ title: "Email Queue — Global3 Contractor" }] }),
  component: EmailQueuePage,
});