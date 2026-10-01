import { toast } from "sonner";
import { api } from "@/lib/api";

/**
 * Shared "Check FAQ" flow used by the LinkedIn conversation compose box and the
 * email queue compose box.
 *
 * Handles multi-question detection: extracts individual questions, searches each,
 * and returns combined draft for answered questions + notification for unanswered ones.
 * Never auto-sends -- the recruiter still has to press Send.
 */
export async function checkFaqAndAutofill(
  message: string | undefined | null,
  setLoading: (loading: boolean) => void,
  setDraft: (draft: string) => void,
  options?: {
    conversationHistory?: Array<{ role: "user" | "assistant"; text: string }>;
    includeConversationContext?: boolean;
  }
): Promise<void> {
  if (!message || !message.trim()) {
    toast.error("No reply from the candidate yet to check");
    return;
  }

  setLoading(true);
  try {
    const result = await api.checkFaq(message, {
      conversationHistory: options?.conversationHistory,
      includeConversationContext: options?.includeConversationContext || false,
    });

    // Guard against hallucinated refusals: detect strong refusal patterns
    // Also check semantic metadata confidence
    const isRefusal = result.answer && (
      /^(i'm unable|unable to answer|i don't have information|no information available|i cannot provide|not available to|unfortunately i|i regret to inform)/i.test(result.answer) ||
      (result.semanticMetadata?.confidence !== undefined && result.semanticMetadata.confidence < 0.50)
    );

    if (result.match === "none") {
      // No matches for any questions
      toast.info("No confident FAQ match for this reply");
    } else if (result.match === "semantic" && result.answer && !isRefusal) {
      // Semantic match: similar FAQ found
      setDraft(result.answer);

      const confidence = result.semanticMetadata?.confidence || 0;
      const confidenceLabel = confidence > 0.80 ? "high confidence" : "moderate confidence";

      toast.success(`Similar FAQ found (${confidenceLabel}) — suggested response added`);

      if (result.answers && result.answers.length > 0) {
        const topicsList = result.answers
          .slice(0, 2)
          .map((a) => `"${a.topic.substring(0, 40)}${a.topic.length > 40 ? "..." : ""}"`)
          .join(", ");
        const moreText = result.answers.length > 2 ? ` (+${result.answers.length - 2} more)` : "";
        toast.info(`Based on: ${topicsList}${moreText}`);
      }
    } else if ((result.match === "full" || result.match === "partial") && result.answer && !isRefusal) {
      // Full or partial exact match: autofill the draft
      setDraft(result.answer);

      if (result.match === "full") {
        toast.success("FAQ match found — draft auto-filled");
      } else {
        // Partial match: some questions answered, some need manual entry
        const unansweredCount = result.unansweredQuestions?.length || 0;
        toast.success(
          `FAQ match found for ${result.answers?.length || 0} question${(result.answers?.length || 0) !== 1 ? "s" : ""}. ` +
            `${unansweredCount} question${unansweredCount !== 1 ? "s" : ""} require${unansweredCount !== 1 ? "" : "s"} manual entry.`
        );

        // Show which questions need manual entry
        if (unansweredCount > 0) {
          const questionsList = result.unansweredQuestions
            .slice(0, 2)
            .map((q) => `"${q.substring(0, 50)}${q.length > 50 ? "..." : ""}"`)
            .join(", ");
          const moreText = unansweredCount > 2 ? ` (+${unansweredCount - 2} more)` : "";
          toast.info(`Questions to answer manually: ${questionsList}${moreText}`);
        }
      }
    } else if (result.answer && isRefusal) {
      // Model hallucinated a refusal instead of grounding
      toast.info("No confident FAQ match for this reply (model refusal detected)");
    } else {
      toast.info("No confident FAQ match for this reply");
    }
  } catch (err: any) {
    if (err?.status === 502 || err?.code === "DRAFTING_SERVICE_UNAVAILABLE") {
      toast.error("Drafting service unavailable — check the FAQ manually");
    } else {
      toast.error(err?.message || "Failed to check FAQ");
    }
  } finally {
    setLoading(false);
  }
}
