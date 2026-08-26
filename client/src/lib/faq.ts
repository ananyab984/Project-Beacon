import { toast } from "sonner";
import { api } from "@/lib/api";

/**
 * Shared "Check FAQ" flow used by the LinkedIn conversation compose box and the
 * email queue compose box.
 *
 * Runs the candidate's latest message through the structured FAQ lookup and,
 * on a confident match, auto-fills the compose draft. Never auto-sends -- the
 * recruiter still has to press Send.
 */
export async function checkFaqAndAutofill(
  message: string | undefined | null,
  setLoading: (loading: boolean) => void,
  setDraft: (draft: string) => void
): Promise<void> {
  if (!message || !message.trim()) {
    toast.error("No reply from the candidate yet to check");
    return;
  }

  setLoading(true);
  try {
    const result = await api.checkFaq(message);
    if (result.match && result.answer) {
      setDraft(result.answer);
      toast.success(`FAQ match found: "${result.matchedQuestion}"`);
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
