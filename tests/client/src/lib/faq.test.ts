import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  api: { checkFaq: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";
import { api } from "@/lib/api";
import { checkFaqAndAutofill } from "@/lib/faq";

describe("checkFaqAndAutofill", () => {
  let setLoading: ReturnType<typeof vi.fn>;
  let setDraft: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setLoading = vi.fn();
    setDraft = vi.fn();
  });

  it("shows an error and skips the API call when message is empty", async () => {
    await checkFaqAndAutofill("", setLoading, setDraft);
    expect(toast.error).toHaveBeenCalledWith("No reply from the candidate yet to check");
    expect(api.checkFaq).not.toHaveBeenCalled();
    expect(setLoading).not.toHaveBeenCalled();
  });

  it("shows an error and skips the API call when message is whitespace", async () => {
    await checkFaqAndAutofill("   ", setLoading, setDraft);
    expect(toast.error).toHaveBeenCalled();
    expect(api.checkFaq).not.toHaveBeenCalled();
  });

  it("shows an error and skips the API call when message is null/undefined", async () => {
    await checkFaqAndAutofill(null, setLoading, setDraft);
    expect(toast.error).toHaveBeenCalled();
    await checkFaqAndAutofill(undefined, setLoading, setDraft);
    expect(api.checkFaq).not.toHaveBeenCalled();
  });

  it("sets the draft and shows success toast on a confident match", async () => {
    vi.mocked(api.checkFaq).mockResolvedValue({ match: true, answer: "Yes we do.", matchedQuestion: "Do you?" });
    await checkFaqAndAutofill("Do you?", setLoading, setDraft);
    expect(setDraft).toHaveBeenCalledWith("Yes we do.");
    expect(toast.success).toHaveBeenCalledWith('FAQ match found: "Do you?"');
  });

  it("shows info toast when there is no match", async () => {
    vi.mocked(api.checkFaq).mockResolvedValue({ match: false });
    await checkFaqAndAutofill("random message", setLoading, setDraft);
    expect(setDraft).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("No confident FAQ match for this reply");
  });

  it("treats a refusal-shaped answer as no match", async () => {
    vi.mocked(api.checkFaq).mockResolvedValue({
      match: true,
      answer: "I don't have that information",
      matchedQuestion: "Q",
    });
    await checkFaqAndAutofill("msg", setLoading, setDraft);
    expect(setDraft).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("No confident FAQ match for this reply");
  });

  it("detects 'unable' refusal pattern case-insensitively", async () => {
    vi.mocked(api.checkFaq).mockResolvedValue({ match: true, answer: "I am UNABLE to answer that", matchedQuestion: "Q" });
    await checkFaqAndAutofill("msg", setLoading, setDraft);
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("detects 'not available' refusal pattern", async () => {
    vi.mocked(api.checkFaq).mockResolvedValue({ match: true, answer: "That is not available right now", matchedQuestion: "Q" });
    await checkFaqAndAutofill("msg", setLoading, setDraft);
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("toggles loading true then false around the call", async () => {
    vi.mocked(api.checkFaq).mockResolvedValue({ match: false });
    await checkFaqAndAutofill("msg", setLoading, setDraft);
    expect(setLoading.mock.calls).toEqual([[true], [false]]);
  });

  it("shows a specific message for a 502 / DRAFTING_SERVICE_UNAVAILABLE error", async () => {
    vi.mocked(api.checkFaq).mockRejectedValue({ status: 502 });
    await checkFaqAndAutofill("msg", setLoading, setDraft);
    expect(toast.error).toHaveBeenCalledWith("Drafting service unavailable — check the FAQ manually");
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it("shows the drafting-service message for a DRAFTING_SERVICE_UNAVAILABLE code without a 502 status", async () => {
    vi.mocked(api.checkFaq).mockRejectedValue({ code: "DRAFTING_SERVICE_UNAVAILABLE" });
    await checkFaqAndAutofill("msg", setLoading, setDraft);
    expect(toast.error).toHaveBeenCalledWith("Drafting service unavailable — check the FAQ manually");
  });

  it("shows the error's own message for other failures", async () => {
    vi.mocked(api.checkFaq).mockRejectedValue({ message: "Network error" });
    await checkFaqAndAutofill("msg", setLoading, setDraft);
    expect(toast.error).toHaveBeenCalledWith("Network error");
  });

  it("falls back to a generic failure message when the error has none", async () => {
    vi.mocked(api.checkFaq).mockRejectedValue({});
    await checkFaqAndAutofill("msg", setLoading, setDraft);
    expect(toast.error).toHaveBeenCalledWith("Failed to check FAQ");
  });
});
