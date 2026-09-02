import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { AddLeadDialog } from "@/components/features/add-lead-dialog";
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

// Dispatching a real click on the submit button hits jsdom's native HTML5
// constraint validation (blocks submission when `type="email"` holds a
// malformed value, exactly like a real browser) before React's onSubmit
// ever runs. Submitting the form directly exercises the same handler while
// bypassing that browser-level gate, which is what the custom regex
// validation this dialog does is actually meant to be tested through.
function submitForm() {
  fireEvent.submit(document.querySelector("form")!);
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof AddLeadDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const setOpen = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AddLeadDialog open setOpen={setOpen} {...overrides} />
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

describe("AddLeadDialog", () => {
  test("renders dialog when open", () => {
    renderDialog();
    expect(screen.getByText("Add a Lead")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Alex Chen")).toBeInTheDocument();
  });

  test("uncontrolled trigger opens dialog", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddLeadDialog trigger={<button>Open Add Lead</button>} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Add a Lead")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Add Lead"));
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

  test("submits with mapped source, services and languages", async () => {
    const { setOpen } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "  Alex Chen  " } });
    fireEvent.change(screen.getByPlaceholderText("alex@example.com"), { target: { value: "alex@example.com" } });
    submitForm();

    await waitFor(() => expect(api.checkDuplicateLead).toHaveBeenCalledWith({
      email: "alex@example.com",
      contactNumber: undefined,
      fullName: "Alex Chen",
      profileLink: undefined,
    }));

    await waitFor(() => expect(api.createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "Alex Chen",
        source: "LINKEDIN",
        email: "alex@example.com",
        secondaryLanguages: ["French"],
        services: [],
        country: "Germany",
      }),
    ));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Lead Alex Chen added to My Leads!"));
    await waitFor(() => expect(setOpen).toHaveBeenCalledWith(false));
  });

  test("duplicate hit warns but still submits", async () => {
    (api.checkDuplicateLead as any).mockResolvedValue({ isDuplicate: true, matchedField: "email", leadId: "existing" });
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Dup Lead" } });
    submitForm();
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("A similar lead may already exist — submitting anyway."));
    await waitFor(() => expect(api.createLead).toHaveBeenCalled());
  });

  test("duplicate check failure does not block submit", async () => {
    (api.checkDuplicateLead as any).mockRejectedValue(new Error("network down"));
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Resilient Lead" } });
    submitForm();
    await waitFor(() => expect(api.createLead).toHaveBeenCalled());
  });

  test("createLead error shows toast", async () => {
    (api.createLead as any).mockRejectedValue(new Error("Server exploded"));
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Failing Lead" } });
    submitForm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Server exploded"));
  });

  test("custom service requires a name before submit", async () => {
    const user = userEvent.setup();
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Needs Service" } });

    const comboboxes = screen.getAllByRole("combobox");
    // Services select is the last combobox in the form (source, source_lang, target_lang, secondary_lang, services)
    const servicesTrigger = comboboxes[comboboxes.length - 1];
    await user.click(servicesTrigger);
    const servicesListbox = await screen.findByRole("listbox");
    await user.click(within(servicesListbox).getByText("+ Custom / Add New Service..."));

    submitForm();
    expect(await screen.findByText("Please enter custom service name")).toBeInTheDocument();
    expect(api.createLead).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText(/Type custom service name/), "Dialogue Editing");
    submitForm();
    await waitFor(() => expect(api.createLead).toHaveBeenCalledWith(
      expect.objectContaining({ services: ["Dialogue Editing"] }),
    ));
  });

  test("custom source: selecting + Custom reveals free-text input", async () => {
    const user = userEvent.setup();
    renderDialog();
    const comboboxes = screen.getAllByRole("combobox");
    const sourceTrigger = comboboxes[0];
    await user.click(sourceTrigger);
    const sourceListbox = await screen.findByRole("listbox");
    await user.click(within(sourceListbox).getByText("+ Custom"));

    const customInput = screen.getByPlaceholderText("Enter custom source…");
    await user.type(customInput, "TikTok");

    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Custom Source Lead" } });
    submitForm();
    await waitFor(() => expect(api.createLead).toHaveBeenCalledWith(
      expect.objectContaining({ source: "LINKEDIN" }), // "TikTok" doesn't match any VALID_SOURCES -> falls back
    ));
  });

  test("all remaining plain inputs and language selects flow into the submit payload", async () => {
    const user = userEvent.setup();
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Alex Chen"), { target: { value: "Full Field Lead" } });
    fireEvent.change(screen.getByPlaceholderText("Germany"), { target: { value: "Spain" } });
    fireEvent.change(screen.getByPlaceholderText("https://linkedin.com/in/…"), { target: { value: "https://linkedin.com/in/full" } });
    fireEvent.change(screen.getByPlaceholderText("+49 …"), { target: { value: "+34 000 000" } });
    const dateInput = document.querySelector('input[type="date"]')!;
    fireEvent.change(dateInput, { target: { value: "2026-09-01" } });

    const comboboxes = screen.getAllByRole("combobox");
    // [source, source_language, target_language, secondary_languages, services]
    await user.click(comboboxes[1]);
    let listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("Japanese"));

    await user.click(comboboxes[2]);
    listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("Korean"));

    await user.click(comboboxes[3]);
    listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("None"));

    submitForm();
    await waitFor(() => expect(api.createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "Full Field Lead",
        country: "Spain",
        profileLink: "https://linkedin.com/in/full",
        contactNumber: "+34 000 000",
        reachoutDate: "2026-09-01",
        sourceLanguage: "Japanese",
        targetLanguage: "Korean",
        secondaryLanguages: ["None"],
      }),
    ));
  });

  test("cancel button closes dialog", () => {
    const { setOpen } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  test("CSV/Excel template download buttons show success toast", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /CSV template/ }));
    expect(toast.success).toHaveBeenCalledWith("Downloaded CSV lead import template!");
    fireEvent.click(screen.getByRole("button", { name: /Excel template/ }));
    expect(toast.success).toHaveBeenCalledWith("Downloaded Excel (.xlsx) lead import template!");
  });

  test("file upload with no duplicates bulk-creates directly", async () => {
    (parseCsvLeads as any).mockReturnValue([
      { display_name: "Row One", source: "LinkedIn", services: ["Dubbing"], email: "one@example.com" },
    ]);
    (api.checkBulkDuplicateLeads as any).mockResolvedValue({
      hasDuplicates: false, duplicateCount: 0, duplicateNames: [], duplicates: [], totalCount: 1, newCount: 1,
    });
    renderDialog();
    const file = new File(["Full Name,Email\nRow One,one@example.com"], "leads.csv", { type: "text/csv" });
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file] } });

    await waitFor(() => expect(api.checkBulkDuplicateLeads).toHaveBeenCalled());
    await waitFor(() => expect(api.bulkCreateLeads).toHaveBeenCalledWith(
      [expect.objectContaining({ fullName: "Row One", source: "LINKEDIN" })],
    ));
  });

  test("file upload with duplicates shows alert and skip-duplicates import", async () => {
    (parseCsvLeads as any).mockReturnValue([
      { display_name: "Dup One", source: "LinkedIn", services: [], email: "dup@example.com" },
      { display_name: "New One", source: "LinkedIn", services: [], email: "new@example.com" },
    ]);
    (api.checkBulkDuplicateLeads as any).mockResolvedValue({
      hasDuplicates: true, duplicateCount: 1, duplicateNames: ["Dup One"], duplicates: [], totalCount: 2, newCount: 1,
    });
    renderDialog();
    const file = new File(["x"], "leads.csv", { type: "text/csv" });
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file] } });

    await screen.findByText(/Lead\(s\) Already Exist in Database/);
    expect(api.bulkCreateLeads).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Import 1 New Leads Only/ }));
    await waitFor(() => expect(api.bulkCreateLeads).toHaveBeenCalledWith([
      expect.objectContaining({ fullName: "Dup One" }),
      expect.objectContaining({ fullName: "New One" }),
    ]));
  });

  test("dismissing duplicate alert clears it without importing", async () => {
    (parseCsvLeads as any).mockReturnValue([{ display_name: "Dup One", source: "LinkedIn", services: [] }]);
    (api.checkBulkDuplicateLeads as any).mockResolvedValue({
      hasDuplicates: true, duplicateCount: 1, duplicateNames: ["Dup One"], duplicates: [], totalCount: 1, newCount: 0,
    });
    renderDialog();
    const file = new File(["x"], "leads.csv", { type: "text/csv" });
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file] } });
    await screen.findByText(/Lead\(s\) Already Exist in Database/);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Lead\(s\) Already Exist in Database/)).not.toBeInTheDocument();
  });

  test("file with no parseable rows shows info toast", async () => {
    (parseCsvLeads as any).mockReturnValue([]);
    renderDialog();
    const file = new File(["garbage"], "bad.csv", { type: "text/csv" });
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file] } });
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("bad.csv")));
  });
});
