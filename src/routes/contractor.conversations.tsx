import { createFileRoute } from "@tanstack/react-router";
import { ConversationsPage } from "./recruiter.conversations";

export const Route = createFileRoute("/contractor/conversations")({
  head: () => ({ meta: [{ title: "Conversations — Global3 Contractor" }] }),
  component: ConversationsPage,
});