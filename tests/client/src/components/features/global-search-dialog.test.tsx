import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { GlobalSearchDialog } from "@/components/features/global-search-dialog";
import { api } from "@/lib/api";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/lib/api", () => ({
  api: {
    getLeads: vi.fn(),
    getUsers: vi.fn(),
    getClients: vi.fn(),
  },
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  // cmdk (used by the shadcn Command primitive) observes size via
  // ResizeObserver, which jsdom doesn't implement.
  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <GlobalSearchDialog />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getLeads as any).mockResolvedValue({
    leads: [{ id: "l1", fullName: "Alex Chen", displayName: null, email: "alex@example.com" }],
    nextCursor: null,
  });
  (api.getUsers as any).mockImplementation((role: string) =>
    Promise.resolve({ users: role === "RECRUITER" ? [{ id: "u1", name: "Sunaina", email: "sunaina@global3.io" }] : [] }),
  );
  (api.getClients as any).mockResolvedValue({
    clients: [{ id: "c1", name: "Acme Studios" }],
  });
});

describe("GlobalSearchDialog", () => {
  test("renders a closed trigger button and does not fetch", () => {
    renderDialog();
    expect(screen.getByText("Search leads, recruiters, clients…")).toBeInTheDocument();
    expect(api.getLeads).not.toHaveBeenCalled();
  });

  test("clicking the trigger opens the command dialog and fetches results", async () => {
    renderDialog();
    fireEvent.click(screen.getByText("Search leads, recruiters, clients…"));
    await waitFor(() => expect(api.getLeads).toHaveBeenCalled());
    expect(await screen.findByText("Alex Chen")).toBeInTheDocument();
    expect(screen.getByText("Sunaina")).toBeInTheDocument();
    expect(screen.getByText("Acme Studios")).toBeInTheDocument();
  });

  test("Cmd+K toggles the dialog open and closed", async () => {
    renderDialog();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(await screen.findByText("Alex Chen")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    await waitFor(() => expect(screen.queryByText("Alex Chen")).not.toBeInTheDocument());
  });

  test("selecting a lead navigates to owner leads with a search query and closes", async () => {
    renderDialog();
    fireEvent.click(screen.getByText("Search leads, recruiters, clients…"));
    const item = await screen.findByText("Alex Chen");
    fireEvent.click(item);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({
      to: "/owner/leads", search: { q: "Alex Chen" },
    }));
  });

  test("selecting a recruiter/contractor navigates to /owner/recruiters", async () => {
    renderDialog();
    fireEvent.click(screen.getByText("Search leads, recruiters, clients…"));
    const item = await screen.findByText("Sunaina");
    fireEvent.click(item);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/owner/recruiters" }));
  });

  test("selecting a client navigates to /owner/clients with a search query", async () => {
    renderDialog();
    fireEvent.click(screen.getByText("Search leads, recruiters, clients…"));
    const item = await screen.findByText("Acme Studios");
    fireEvent.click(item);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({
      to: "/owner/clients", search: { q: "Acme Studios" },
    }));
  });

  test("falls back to 'Unnamed lead' when both name fields are missing", async () => {
    (api.getLeads as any).mockResolvedValue({
      leads: [{ id: "l2", fullName: null, displayName: null, email: null }],
      nextCursor: null,
    });
    renderDialog();
    fireEvent.click(screen.getByText("Search leads, recruiters, clients…"));
    expect(await screen.findByText("Unnamed lead")).toBeInTheDocument();
  });
});
