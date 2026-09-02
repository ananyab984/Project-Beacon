import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AssignRecruiterDialog } from "@/components/features/assign-recruiter-dialog";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { ApiRequirement } from "@/lib/api-types";

vi.mock("@/lib/api", () => ({
  api: {
    getUsers: vi.fn(),
    getRequirements: vi.fn(),
    assignRequirement: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const requirement = {
  id: "req1",
  title: "Dubbing Lead — German",
  language: "German",
  service: "Dubbing",
  recruiterId: null,
} as unknown as ApiRequirement;

function renderDialog(overrides: Partial<React.ComponentProps<typeof AssignRecruiterDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onOpenChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AssignRecruiterDialog requirement={requirement} open onOpenChange={onOpenChange} {...overrides} />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getUsers as any).mockResolvedValue({
    users: [
      { id: "r1", name: "Sunaina", languages: ["German", "French"] },
      { id: "r2", name: "Mathumitha", languages: ["Tamil", "Hindi"] },
    ],
  });
  (api.getRequirements as any).mockResolvedValue({
    requirements: [
      { id: "req1", recruiterId: null, status: "ACTIVE" },
      { id: "req2", recruiterId: "r1", status: "ACTIVE" },
      { id: "req3", recruiterId: "r1", status: "ACTIVE" },
    ],
  });
  (api.assignRequirement as any).mockResolvedValue({ requirement: { id: "req1", recruiterId: "r1" } });
});

describe("AssignRecruiterDialog", () => {
  test("renders null when there is no requirement", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <AssignRecruiterDialog requirement={null} open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  test("shows recruiters with language-match badge and active requirement counts", async () => {
    renderDialog();
    expect(await screen.findByText("Sunaina")).toBeInTheDocument();
    expect(screen.getByText("Language match")).toBeInTheDocument();
    expect(screen.getByText("2 active requirements")).toBeInTheDocument();
    expect(screen.getByText("0 active requirements", { exact: false })).toBeInTheDocument();
  });

  test("search filters recruiters by name", async () => {
    renderDialog();
    await screen.findByText("Sunaina");
    fireEvent.change(screen.getByPlaceholderText(/Search by name or language/), { target: { value: "Math" } });
    expect(screen.getByText("Mathumitha")).toBeInTheDocument();
    expect(screen.queryByText("Sunaina")).not.toBeInTheDocument();
  });

  test("search by language shows the language-search hint", async () => {
    renderDialog();
    await screen.findByText("Sunaina");
    fireEvent.change(screen.getByPlaceholderText(/Search by name or language/), { target: { value: "Tamil" } });
    expect(screen.getByText(/language associations are a search aid only/)).toBeInTheDocument();
    expect(screen.getByText("Mathumitha")).toBeInTheDocument();
    expect(screen.queryByText("Sunaina")).not.toBeInTheDocument();
  });

  test("no matches shows empty state", async () => {
    renderDialog();
    await screen.findByText("Sunaina");
    fireEvent.change(screen.getByPlaceholderText(/Search by name or language/), { target: { value: "Zzzz" } });
    expect(screen.getByText("No recruiters match your search.")).toBeInTheDocument();
  });

  test("selecting a recruiter assigns and closes", async () => {
    const { onOpenChange } = renderDialog();
    await screen.findByText("Sunaina");
    fireEvent.click(screen.getAllByRole("button", { name: "Select" })[0]);
    await waitFor(() => expect(api.assignRequirement).toHaveBeenCalledWith("req1", "r1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Dubbing Lead — German assigned to Sunaina"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("currently assigned recruiter shows disabled state, not a Select button", async () => {
    renderDialog({ requirement: { ...requirement, recruiterId: "r1" } as any });
    await screen.findByText("Sunaina");
    expect(screen.getByText("Currently Assigned")).toBeInTheDocument();
  });

  test("Remove assignment unassigns when a recruiter is set", async () => {
    const { onOpenChange } = renderDialog({ requirement: { ...requirement, recruiterId: "r1" } as any });
    await screen.findByText("Sunaina");
    fireEvent.click(screen.getByRole("button", { name: /Remove assignment/ }));
    await waitFor(() => expect(api.assignRequirement).toHaveBeenCalledWith("req1", null));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Dubbing Lead — German unassigned"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("no unassign link shown when nothing is currently assigned", async () => {
    renderDialog();
    await screen.findByText("Sunaina");
    expect(screen.getByText("No recruiter currently assigned")).toBeInTheDocument();
    expect(screen.queryByText(/Remove assignment/)).not.toBeInTheDocument();
  });

  test("assign failure shows error toast", async () => {
    (api.assignRequirement as any).mockRejectedValue(new Error("Server error"));
    renderDialog();
    await screen.findByText("Sunaina");
    fireEvent.click(screen.getAllByRole("button", { name: "Select" })[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Server error"));
  });

  test("Cancel button closes and clears search", async () => {
    const { onOpenChange } = renderDialog();
    await screen.findByText("Sunaina");
    fireEvent.change(screen.getByPlaceholderText(/Search by name or language/), { target: { value: "Sun" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
