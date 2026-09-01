import { createFileRoute } from "@tanstack/react-router";
import { ConversationsPageView } from "@/components/features/conversations-page-view";

export const Route = createFileRoute("/owner/conversations")({
  head: () => ({ meta: [{ title: "Conversations — Global3 Owner Console" }] }),
  component: ConversationsPageView,
});
