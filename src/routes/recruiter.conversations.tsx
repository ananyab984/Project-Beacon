import { createFileRoute } from "@tanstack/react-router";
import { ConversationsPageView } from "@/components/g3/conversations-page-view";

export const Route = createFileRoute("/recruiter/conversations")({
  head: () => ({ meta: [{ title: "Conversations — Global3 Recruiter" }] }),
  component: ConversationsPageView,
});