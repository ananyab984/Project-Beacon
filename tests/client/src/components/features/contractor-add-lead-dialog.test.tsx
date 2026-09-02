import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ContractorAddLeadDialog } from "@/components/features/contractor-add-lead-dialog";
import { api } from "@/lib/api";
import { toast } from "sonner";

vi.mock("@/lib/api", () => ({
  api: {
    createLead: vi.fn(),
    bulkCreateLeads: vi.fn(),
    checkDuplicateLead: vi.fn(),
    checkBulkDuplicateLeads: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/g3-mock", () => ({
  parseCsvLeads: vi.fn(),
}));

import { parseCsvLeads } from "@/lib/g3-mock";

beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
});

function submitForm() {
  fireEvent.submit(document.querySelector("form")!);
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof ContractorAddLeadDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const setOpen = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ContractorAddLeadDialog open setOpen={setOpen} {...overrides} />
    </QueryClientProvider>,
  );
  return { ...utils, setOpen, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.checkDuplicateLead as any).mockResolvedValue({ isDuplicate: false, matchedField: null, leadId: null });
  (api.createLead as any).mockResolvedValue({ lead: { id: "l1" }, duplicateWarning: null });
  (api.bulkCreateLeads as any).mockResolvedValue({ results: [] });
});

describe("ContractorAddLeadDialog", () => {
  test("renders dialog when open", () => {
    renderDialog();
    expect(screen.getByText("Add a Lead")).toBeInTheDocument();
  });

  test("uncontrolled trigger opens dialog", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ContractorAddLeadDialog trigger={<button>Open</button>} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Add a Lead")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Add a Lead")).toBeInTheDocument();
  });

  test("validation: empty full name blocks submit", async () => {
    renderDialog();
    submitForm();
    expect(await screen.findByText("Full name is required")).toBeInTheDocument();
    expect(api.createLead).not.toHaveBeenCalled();
  });

  test("validation: invalid email blocks submit", async () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Alex Chen" } });
    fireEvent.change(screen.getByPlaceholderText("alex@example.com"), { target: { value: "not-an-email" } });
    submitForm();
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(api.createLead).not.toHaveBeenCalled();
  });

  test("submits with mapped source and shows 'submitted to pipeline' toast", async () => {
    const { setOpen } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Alex Chen" } });
    submitForm();
    await waitFor(() => expect(api.createLead).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "Alex Chen", source: "LINKEDIN" }),
    ));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Lead Alex Chen submitted to pipeline!"));
    await waitFor(() => expect(setOpen).toHaveBeenCalledWith(false));
  });

  test("onCheck: 'Check for duplicates' button surfaces a hit", async () => {
    (api.checkDuplicateLead as any).mockResolvedValue({ isDuplicate: true, matchedField: "email", leadId: "existing" });
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Dup Candidate" } });
    fireEvent.click(screen.getByRole("button", { name: "Check for duplicates" }));
    expect(await screen.findByText("A similar lead may already exist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit anyway" })).toBeInTheDocument();
  });

  test("onCheck: no duplicate shows the clean confirmation", async () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Clean Candidate" } });
    fireEvent.click(screen.getByRole("button", { name: "Check for duplicates" }));
    expect(await screen.findByText("No duplicate found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit lead" })).toBeInTheDocument();
  });

  test("onCheck validation failure shows toast and does not call checkDuplicateLead", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Check for duplicates" }));
    await waitFor(() => expect(screen.getByText("Full name is required")).toBeInTheDocument());
    expect(api.checkDuplicateLead).not.toHaveBeenCalled();
  });

  test("onCheck failure shows error toast", async () => {
    (api.checkDuplicateLead as any).mockRejectedValue(new Error("network down"));
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Flaky Candidate" } });
    fireEvent.click(screen.getByRole("button", { name: "Check for duplicates" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("network down"));
  });

  test("editing a field after a dup check resets the dup banner", async () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Reset Candidate" } });
    fireEvent.click(screen.getByRole("button", { name: "Check for duplicates" }));
    await screen.findByText("No duplicate found");
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Reset Candidate 2" } });
    expect(screen.queryByText("No duplicate found")).not.toBeInTheDocument();
  });

  test("submit skips the redundant pre-check when dup already checked", async () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Already Checked" } });
    fireEvent.click(screen.getByRole("button", { name: "Check for duplicates" }));
    await screen.findByText("No duplicate found");
    (api.checkDuplicateLead as any).mockClear();
    submitForm();
    await waitFor(() => expect(api.createLead).toHaveBeenCalled());
    expect(api.checkDuplicateLead).not.toHaveBeenCalled();
  });

  test("custom service requires a name before submit", async () => {
    const user = userEvent.setup();
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Needs Service" } });

    const comboboxes = screen.getAllByRole("combobox");
    const servicesTrigger = comboboxes[comboboxes.length - 1];
    await user.click(servicesTrigger);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("+ Custom / Add New Service..."));

    submitForm();
    expect(await screen.findByText("Please enter custom service name")).toBeInTheDocument();
    expect(api.createLead).not.toHaveBeenCalled();
  });

  test("bulk upload: no duplicates imports directly", async () => {
    (parseCsvLeads as any).mockReturnValue([
      { display_name: "Row One", source: "LinkedIn", services: [], language: "German" },
    ]);
    (api.checkBulkDuplicateLeads as any).mockResolvedValue({
      hasDuplicates: false, duplicateCount: 0, duplicateNames: [], duplicates: [], totalCount: 1, newCount: 1,
    });
    renderDialog();
    const file = new File(["x"], "leads.csv", { type: "text/csv" });
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file] } });
    await waitFor(() => expect(api.bulkCreateLeads).toHaveBeenCalledWith(
      [expect.objectContaining({ fullName: "Row One", source: "LINKEDIN" })],
    ));
  });

  test("bulk upload: duplicates shown, skip-duplicates import works", async () => {
    (parseCsvLeads as any).mockReturnValue([
      { display_name: "Dup One", source: "LinkedIn", services: [] },
      { display_name: "New One", source: "LinkedIn", services: [] },
    ]);
    (api.checkBulkDuplicateLeads as any).mockResolvedValue({
      hasDuplicates: true, duplicateCount: 1, duplicateNames: ["Dup One"], duplicates: [], totalCount: 2, newCount: 1,
    });
    renderDialog();
    const file = new File(["x"], "leads.csv", { type: "text/csv" });
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file] } });
    await screen.findByText(/Lead\(s\) Already Exist in Database/);
    fireEvent.click(screen.getByRole("button", { name: /Submit 1 New Leads Only/ }));
    await waitFor(() => expect(api.bulkCreateLeads).toHaveBeenCalledWith([
      expect.objectContaining({ fullName: "Dup One" }),
      expect.objectContaining({ fullName: "New One" }),
    ]));
  });

  test("bulk duplicate check network failure falls back to direct import", async () => {
    (parseCsvLeads as any).mockReturnValue([{ display_name: "Fallback Row", source: "LinkedIn", services: [] }]);
    (api.checkBulkDuplicateLeads as any).mockRejectedValue(new Error("offline"));
    renderDialog();
    const file = new File(["x"], "leads.csv", { type: "text/csv" });
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file] } });
    await waitFor(() => expect(api.bulkCreateLeads).toHaveBeenCalledWith(
      [expect.objectContaining({ fullName: "Fallback Row" })],
    ));
  });

  test("file with no parseable rows shows info toast", async () => {
    (parseCsvLeads as any).mockReturnValue([]);
    renderDialog();
    const file = new File(["garbage"], "bad.csv", { type: "text/csv" });
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file] } });
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("bad.csv")));
  });

  test("all remaining plain inputs and language selects flow into the submit payload", async () => {
    const user = userEvent.setup();
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Full Field Lead" } });
    fireEvent.change(screen.getByPlaceholderText("Germany"), { target: { value: "Spain" } });
    fireEvent.change(screen.getByPlaceholderText("https://linkedin.com/in/…"), { target: { value: "https://linkedin.com/in/full" } });
    fireEvent.change(screen.getByPlaceholderText("+49 …"), { target: { value: "+34 000 000" } });
    const dateInput = document.querySelector('input[type="date"]')!;
    fireEvent.change(dateInput, { target: { value: "2026-09-01" } });

    const comboboxes = screen.getAllByRole("combobox");
    await user.click(comboboxes[1]);
    let listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("Japanese"));

    await user.click(comboboxes[2]);
    listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("Korean"));

    submitForm();
    await waitFor(() => expect(api.createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "Full Field Lead",
        firstName: "Alex",
        country: "Spain",
        profileLink: "https://linkedin.com/in/full",
        contactNumber: "+34 000 000",
        reachoutDate: "2026-09-01",
        sourceLanguage: "Japanese",
        targetLanguage: "Korean",
      }),
    ));
  });

  test("cancel button closes dialog", () => {
    const { setOpen } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(setOpen).toHaveBeenCalledWith(false);
  });
});
