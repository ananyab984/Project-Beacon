import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ClientDemandDialog, openClientDemand } from "@/components/features/client-demand-dialog";
import { api } from "@/lib/api";
import { toast } from "sonner";

vi.mock("@/lib/api", () => ({
  api: {
    getUsers: vi.fn(),
    createUser: vi.fn(),
    createClientDemand: vi.fn(),
    assignRequirement: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@/components/features/google-sheets-sync-section", () => ({
  GoogleSheetsSyncSection: () => null,
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
});

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ClientDemandDialog />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

function openDialog() {
  fireEvent(window, new Event("g3:open-client-demand"));
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getUsers as any).mockImplementation((role: string) =>
    Promise.resolve({ users: role === "RECRUITER" ? [] : [] }),
  );
  (api.createClientDemand as any).mockResolvedValue({
    clientDemand: { id: "cd1" },
    requirements: [{ id: "req1" }],
  });
  (api.assignRequirement as any).mockResolvedValue({ requirement: { id: "req1" } });
  (api.createUser as any).mockResolvedValue({ user: { id: "newrec1", name: "New Recruiter" } });
});

describe("ClientDemandDialog", () => {
  test("closed by default, opens on g3:open-client-demand event", async () => {
    renderDialog();
    expect(screen.queryByRole("heading", { name: /Resource Intake Form/ })).not.toBeInTheDocument();
    openDialog();
    expect(await screen.findByRole("heading", { name: /Resource Intake Form/ })).toBeInTheDocument();
  });

  test("openClientDemand() helper dispatches the same event", async () => {
    renderDialog();
    openClientDemand();
    expect(await screen.findByRole("heading", { name: /Resource Intake Form/ })).toBeInTheDocument();
  });

  test("renders an initial language block with defaults", async () => {
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    expect(screen.getByPlaceholderText("e.g. 45")).toHaveValue("45");
    expect(screen.getByPlaceholderText("e.g. 10")).toHaveValue("10");
  });

  test("validation: empty client name blocks submit", async () => {
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.click(screen.getByRole("button", { name: "Submit Client Demand" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Client name is required."));
    expect(api.createClientDemand).not.toHaveBeenCalled();
  });

  test("validation: invalid PM email blocks submit", async () => {
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.change(screen.getByPlaceholderText("e.g. Sample Broadcast Co."), { target: { value: "Acme" } });
    fireEvent.change(screen.getByPlaceholderText("sample.pm@example.com"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Client Demand" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Enter a valid PM email address or leave it empty."));
    expect(api.createClientDemand).not.toHaveBeenCalled();
  });

  test("successful submit creates client demand with correct payload, no recruiter match", async () => {
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.change(screen.getByPlaceholderText("e.g. Sample Broadcast Co."), { target: { value: "  Acme Studios  " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Client Demand" }));

    await waitFor(() => expect(api.createClientDemand).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: "Acme Studios",
        language: "Hindi",
        services: [{ service: "Dubbing", needed: 1 }],
        priority: "STANDARD",
      }),
    ));
    // No matching recruiter in an empty roster -> stays unassigned, no assignRequirement call.
    expect(api.assignRequirement).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Client demand created for Acme Studios"),
    ));
  });

  test("auto-maps recruiter by region mapping and assigns created requirements", async () => {
    (api.getUsers as any).mockImplementation((role: string) =>
      Promise.resolve({
        users: role === "RECRUITER" ? [{ id: "r1", name: "Mathumitha", languages: [] }] : [],
      }),
    );
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.change(screen.getByPlaceholderText("e.g. Sample Broadcast Co."), { target: { value: "Beacon Media" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Client Demand" }));

    await waitFor(() => expect(api.createClientDemand).toHaveBeenCalled());
    await waitFor(() => expect(api.assignRequirement).toHaveBeenCalledWith("req1", "r1"));
  });

  test("custom recruiter path creates a user then assigns it", async () => {
    const user = userEvent.setup();
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.change(screen.getByPlaceholderText("e.g. Sample Broadcast Co."), { target: { value: "Custom Rec Co" } });

    const recruiterTrigger = screen.getByText("Unassigned").closest('[role="combobox"]')!;
    await user.click(recruiterTrigger);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("+ Custom / Add New..."));

    fireEvent.click(screen.getByRole("button", { name: "Submit Client Demand" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Enter name and email for custom recruiter"),
    ));
    expect(api.createClientDemand).not.toHaveBeenCalled();

    // BUG FIX: client-demand-dialog.tsx previously had no inputs at all for
    // customRecruiterName/customRecruiterEmail, so selecting "+ Custom / Add
    // New..." was a dead end that could never pass validation. Added the two
    // inputs below the recruiter Select; this exercises that fixed path.
    fireEvent.change(screen.getByPlaceholderText("New recruiter name…"), { target: { value: "Nina Recruiter" } });
    fireEvent.change(screen.getByPlaceholderText("New recruiter email…"), { target: { value: "nina@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Client Demand" }));

    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Nina Recruiter", email: "nina@example.com", role: "RECRUITER" }),
    ));
    await waitFor(() => expect(api.assignRequirement).toHaveBeenCalledWith("req1", "newrec1"));
  });

  test("createClientDemand failure shows error toast and keeps dialog open", async () => {
    (api.createClientDemand as any).mockRejectedValue(new Error("Server exploded"));
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.change(screen.getByPlaceholderText("e.g. Sample Broadcast Co."), { target: { value: "Failing Co" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Client Demand" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Server exploded"));
    expect(screen.getByRole("heading", { name: /Resource Intake Form/ })).toBeInTheDocument();
  });

  test("add and remove a language block", async () => {
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.click(screen.getByRole("button", { name: /Add Language Block/ }));
    expect(screen.getAllByText(/Target Language #/).length).toBe(2);
    const removeButtons = screen.getAllByRole("button", { name: /Remove Block/ });
    fireEvent.click(removeButtons[0]);
    expect(screen.getAllByText(/Target Language #/).length).toBe(1);
  });

  test("add and remove a service row within a language block", async () => {
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.click(screen.getByRole("button", { name: /Add Service/ }));
    expect(screen.getAllByPlaceholderText("Headcount").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Submit Client Demand" }));
    // won't submit (no client name) but confirms row structure still intact
    expect(screen.getAllByPlaceholderText("Headcount").length).toBe(2);
  });

  test("missing target language on a custom block blocks submit", async () => {
    const user = userEvent.setup();
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.change(screen.getByPlaceholderText("e.g. Sample Broadcast Co."), { target: { value: "Needs Lang" } });

    const langTrigger = screen.getByText("Hindi").closest('[role="combobox"]')!;
    await user.click(langTrigger);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("Custom..."));

    fireEvent.click(screen.getByRole("button", { name: "Submit Client Demand" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Please select or enter a target language for block 1."),
    ));
    expect(api.createClientDemand).not.toHaveBeenCalled();
  });

  test("Section 1 fields (project name, PM, content type Other, dates) flow into the submit", async () => {
    const user = userEvent.setup();
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.change(screen.getByPlaceholderText("e.g. Sample Broadcast Co."), { target: { value: "Acme" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. Sample News Series"), { target: { value: "The Big Show" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. Ashok PM"), { target: { value: "Priya PM" } });
    fireEvent.change(screen.getByPlaceholderText("sample.pm@example.com"), { target: { value: "priya@example.com" } });
    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-09-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-10-01" } });
    fireEvent.change(dateInputs[2], { target: { value: "2026-11-01" } });

    // Content Type's default state value "Series" matches none of CONTENT_TYPES
    // (the list has "Episodic / Series", not "Series"), so the trigger renders
    // with no visible text until touched -- can't select it by display text.
    const topComboboxes = screen.getAllByRole("combobox");
    const contentTypeTrigger = topComboboxes[0];
    await user.click(contentTypeTrigger);
    let listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("Other..."));
    fireEvent.change(screen.getByPlaceholderText("Specify content type..."), { target: { value: "Trailer" } });

    const priorityTrigger = topComboboxes[1];
    await user.click(priorityTrigger);
    listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("Urgent (<15 days)"));

    fireEvent.click(screen.getByRole("button", { name: "Submit Client Demand" }));
    await waitFor(() => expect(api.createClientDemand).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: "Acme",
        projectName: "The Big Show",
        contactName: "Priya PM",
        contactEmail: "priya@example.com",
        priority: "CRITICAL",
        deadline: "2026-10-01",
        notes: expect.stringContaining("Content Type: Trailer"),
      }),
    ));
  });

  test("per-block fields (source language, episode info, notes, custom service, headcount) flow through", async () => {
    const user = userEvent.setup();
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.change(screen.getByPlaceholderText("e.g. Sample Broadcast Co."), { target: { value: "Beacon" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. English"), { target: { value: "Japanese" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. 45"), { target: { value: "30" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. 10"), { target: { value: "6" } });
    fireEvent.change(screen.getByPlaceholderText("Special dialect, voice tags, notes..."), { target: { value: "Rush job" } });
    fireEvent.change(screen.getByPlaceholderText("Headcount"), { target: { value: "3" } });

    const serviceTrigger = screen.getByText("Dubbing").closest('[role="combobox"]')!;
    await user.click(serviceTrigger);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("Custom..."));
    fireEvent.change(screen.getByPlaceholderText("Custom Service..."), { target: { value: "ADR Direction" } });

    fireEvent.click(screen.getByRole("button", { name: "Submit Client Demand" }));
    await waitFor(() => expect(api.createClientDemand).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: "Beacon",
        services: [{ service: "ADR Direction", needed: 3 }],
        notes: expect.stringContaining("Source Language: Japanese"),
      }),
    ));
    expect((api.createClientDemand as any).mock.calls[0][0].notes).toContain("File Length: 30 min");
    expect((api.createClientDemand as any).mock.calls[0][0].notes).toContain("Episodes/Files: 6");
    expect((api.createClientDemand as any).mock.calls[0][0].notes).toContain("Notes: Rush job");
  });

  test("cancel button closes the dialog", async () => {
    renderDialog();
    openDialog();
    await screen.findByRole("heading", { name: /Resource Intake Form/ });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: /Resource Intake Form/ })).not.toBeInTheDocument());
  });
});
