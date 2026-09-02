import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FaqManager } from "@/components/dashboard/faq-manager";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    listFaqs: vi.fn(),
    createFaq: vi.fn(),
    updateFaq: vi.fn(),
    deleteFaq: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const faqs = [
  {
    id: "faq-1",
    category: "Payment",
    question: "When do I get paid?",
    answer: "Net 30 after invoice.",
    tags: ["payment", "invoice"],
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "faq-2",
    category: "Training",
    question: "Is there onboarding training?",
    answer: "Yes, a 1-hour session.",
    tags: [],
    isActive: true,
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
];

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FaqManager />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("FaqManager", () => {
  it("shows loading state then renders FAQ list", async () => {
    (api.listFaqs as any).mockResolvedValue({ faqEntries: faqs });
    renderWithClient();
    expect(screen.getByText(/Loading FAQs/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("When do I get paid?")).toBeInTheDocument());
    expect(screen.getByText("Is there onboarding training?")).toBeInTheDocument();
    expect(screen.getByText("payment")).toBeInTheDocument();
  });

  it("renders empty state with no FAQs", async () => {
    (api.listFaqs as any).mockResolvedValue({ faqEntries: [] });
    renderWithClient();
    await waitFor(() => expect(screen.queryByText(/Loading FAQs/i)).not.toBeInTheDocument());
    expect(screen.getByText("Manage FAQs")).toBeInTheDocument();
    expect(screen.queryByText("When do I get paid?")).not.toBeInTheDocument();
  });

  it("creates a new FAQ via the create form", async () => {
    const user = userEvent.setup();
    (api.listFaqs as any).mockResolvedValue({ faqEntries: [] });
    (api.createFaq as any).mockResolvedValue({ faqEntry: { ...faqs[0] }, keywordsGenerated: true });
    renderWithClient();
    await waitFor(() => expect(screen.queryByText(/Loading FAQs/i)).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add FAQ/i }));
    expect(screen.getByText("Create New FAQ")).toBeInTheDocument();

    const createButton = screen.getByRole("button", { name: /Create FAQ/i });
    expect(createButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Category/i), "Payment");
    await user.type(screen.getByPlaceholderText("Question"), "When do I get paid?");
    await user.type(screen.getByPlaceholderText("Answer"), "Net 30 after invoice.");
    expect(createButton).toBeEnabled();

    await user.click(createButton);
    await waitFor(() =>
      expect(api.createFaq).toHaveBeenCalledWith({
        category: "Payment",
        question: "When do I get paid?",
        answer: "Net 30 after invoice.",
      })
    );
  });

  it("cancels the create form", async () => {
    const user = userEvent.setup();
    (api.listFaqs as any).mockResolvedValue({ faqEntries: [] });
    renderWithClient();
    await waitFor(() => expect(screen.queryByText(/Loading FAQs/i)).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Add FAQ/i }));
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByText("Create New FAQ")).not.toBeInTheDocument();
  });

  it("edits an existing FAQ, including tag parsing", async () => {
    const user = userEvent.setup();
    (api.listFaqs as any).mockResolvedValue({ faqEntries: [faqs[0]] });
    (api.updateFaq as any).mockResolvedValue({ faqEntry: faqs[0] });
    renderWithClient();
    await waitFor(() => expect(screen.getByText("When do I get paid?")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Edit/i }));
    expect(screen.getByText("Edit FAQ")).toBeInTheDocument();

    const keywordsInput = screen.getByLabelText(/Keywords/i);
    await user.clear(keywordsInput);
    await user.type(keywordsInput, "payment, billing ,  invoice");

    await user.click(screen.getByRole("button", { name: /Save FAQ/i }));
    await waitFor(() =>
      expect(api.updateFaq).toHaveBeenCalledWith("faq-1", {
        category: "Payment",
        question: "When do I get paid?",
        answer: "Net 30 after invoice.",
        tags: ["payment", "billing", "invoice"],
      })
    );
  });

  it("cancels editing", async () => {
    const user = userEvent.setup();
    (api.listFaqs as any).mockResolvedValue({ faqEntries: [faqs[0]] });
    renderWithClient();
    await waitFor(() => expect(screen.getByText("When do I get paid?")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Edit/i }));
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByText("Edit FAQ")).not.toBeInTheDocument();
    expect(screen.getByText("When do I get paid?")).toBeInTheDocument();
  });

  it("deletes an FAQ after confirming", async () => {
    const user = userEvent.setup();
    (api.listFaqs as any).mockResolvedValue({ faqEntries: [faqs[0]] });
    (api.deleteFaq as any).mockResolvedValue({ success: true });
    renderWithClient();
    await waitFor(() => expect(screen.getByText("When do I get paid?")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Delete/i }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.deleteFaq).toHaveBeenCalledWith("faq-1"));
  });

  it("skips delete when confirm is declined", async () => {
    const user = userEvent.setup();
    (window.confirm as any).mockReturnValue(false);
    (api.listFaqs as any).mockResolvedValue({ faqEntries: [faqs[0]] });
    renderWithClient();
    await waitFor(() => expect(screen.getByText("When do I get paid?")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Delete/i }));
    expect(api.deleteFaq).not.toHaveBeenCalled();
  });
});
