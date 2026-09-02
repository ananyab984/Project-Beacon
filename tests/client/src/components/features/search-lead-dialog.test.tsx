import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SearchLeadDialog } from "@/components/features/search-lead-dialog";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { getLeads: vi.fn() },
}));

const leads = [
  { id: "l1", fullName: "Alex Chen", displayName: null, email: "alex@example.com", country: "Germany", services: ["Dubbing"], enrichmentStatus: "COMPLETE", source: "LINKEDIN", profileLink: "https://linkedin.com/in/alex" },
  { id: "l2", fullName: "Jamie Fox", displayName: null, email: "jamie@example.com", country: "France", services: [], enrichmentStatus: "PENDING", source: "PROZ", profileLink: null },
];

function renderDialog(overrides: Partial<React.ComponentProps<typeof SearchLeadDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onOpenChange = vi.fn();
  const onSelectLead = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SearchLeadDialog open onOpenChange={onOpenChange} onSelectLead={onSelectLead} {...overrides} />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange, onSelectLead, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getLeads as any).mockResolvedValue({ leads, nextCursor: null });
});

describe("SearchLeadDialog", () => {
  test("lists leads with enrichment badges", async () => {
    renderDialog();
    expect(await screen.findByText("Alex Chen")).toBeInTheDocument();
    expect(screen.getByText("Jamie Fox")).toBeInTheDocument();
    expect(screen.getByText("Enriched")).toBeInTheDocument();
    expect(screen.getByText("Enrichment: PENDING")).toBeInTheDocument();
  });

  test("does not fetch when closed", () => {
    renderDialog({ open: false });
    expect(api.getLeads).not.toHaveBeenCalled();
  });

  test("shows loading state", () => {
    (api.getLeads as any).mockReturnValue(new Promise(() => {}));
    renderDialog();
    expect(screen.getByText("Loading leads roster…")).toBeInTheDocument();
  });

  test("search filters by name, email, and country", async () => {
    renderDialog();
    await screen.findByText("Alex Chen");
    fireEvent.change(screen.getByPlaceholderText(/Search leads by name/), { target: { value: "france" } });
    expect(screen.getByText("Jamie Fox")).toBeInTheDocument();
    expect(screen.queryByText("Alex Chen")).not.toBeInTheDocument();
  });

  test("no matches shows empty state", async () => {
    renderDialog();
    await screen.findByText("Alex Chen");
    fireEvent.change(screen.getByPlaceholderText(/Search leads by name/), { target: { value: "zzz-nomatch" } });
    expect(screen.getByText("No leads matched your search query.")).toBeInTheDocument();
  });

  test("requireLinkedIn filters out non-LinkedIn/non-profile leads", async () => {
    renderDialog({ requireLinkedIn: true });
    expect(await screen.findByText("Alex Chen")).toBeInTheDocument();
    expect(screen.queryByText("Jamie Fox")).not.toBeInTheDocument();
  });

  test("selecting a lead calls onSelectLead and closes on success", async () => {
    const onSelectLead = vi.fn().mockResolvedValue(undefined);
    const { onOpenChange } = renderDialog({ onSelectLead });
    await screen.findByText("Alex Chen");
    fireEvent.click(screen.getAllByRole("button", { name: /Select Lead/ })[0]);
    await waitFor(() => expect(onSelectLead).toHaveBeenCalledWith(leads[0]));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  test("dialog stays open if onSelectLead rejects, but clears loading state", async () => {
    const onSelectLead = vi.fn().mockRejectedValue(new Error("failed to add"));
    const { onOpenChange } = renderDialog({ onSelectLead });
    await screen.findByText("Alex Chen");
    fireEvent.click(screen.getAllByRole("button", { name: /Select Lead/ })[0]);
    await waitFor(() => expect(onSelectLead).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  test("custom title and description render", async () => {
    renderDialog({ title: "Pick a Candidate", description: "Custom desc" });
    expect(screen.getByText("Pick a Candidate")).toBeInTheDocument();
    expect(screen.getByText("Custom desc")).toBeInTheDocument();
  });

  test("uncontrolled trigger opens dialog and then fetches", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SearchLeadDialog trigger={<button>Open Search</button>} onSelectLead={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(api.getLeads).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Open Search"));
    await waitFor(() => expect(api.getLeads).toHaveBeenCalled());
  });
});
