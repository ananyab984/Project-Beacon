import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ManualEnrichmentDialog, type LeadForEnrichment } from "@/components/features/manual-enrichment-dialog";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";

const baseLead: LeadForEnrichment = {
  id: "lead1",
  name: "Alex Chen",
  email: null,
  phone: null,
  country: "Germany",
  profile_link: null,
  language: "German",
  source_language: "English",
  target_language: "German",
  services: ["Dubbing"],
  years_experience: 5,
  vendor_experience: "Netflix, HBO",
  enrichment_status: "pending",
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof ManualEnrichmentDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onMarkEnriched = vi.fn();
  const utils = render(
    <ManualEnrichmentDialog
      open
      onOpenChange={onOpenChange}
      lead={baseLead}
      onMarkEnriched={onMarkEnriched}
      {...overrides}
    />,
  );
  return { ...utils, onOpenChange, onMarkEnriched };
}

describe("ManualEnrichmentDialog", () => {
  test("renders null when there is no lead", () => {
    const { container } = render(
      <ManualEnrichmentDialog open onOpenChange={vi.fn()} lead={null} onMarkEnriched={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("prefills fields from the lead", () => {
    renderDialog();
    expect(screen.getByDisplayValue("Alex Chen")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Germany")).toBeInTheDocument();
    expect(screen.getByDisplayValue("English")).toBeInTheDocument();
    expect(screen.getByDisplayValue("German")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Netflix, HBO")).toBeInTheDocument();
  });

  test("shows 'On Hold' badge when no contact info present", () => {
    renderDialog();
    expect(screen.getByText("🟡 On Hold")).toBeInTheDocument();
    expect(screen.getByText("Action Required")).toBeInTheDocument();
  });

  test("shows 'Ready to Enrich' badge once email is filled", () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), { target: { value: "alex@example.com" } });
    expect(screen.getByText("🟢 Ready to Enrich")).toBeInTheDocument();
    expect(screen.getByText("Candidate details detected")).toBeInTheDocument();
  });

  test("phone alone also counts as contact info", () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("+1 234 567 8900"), { target: { value: "+1 555 0100" } });
    expect(screen.getByText("🟢 Ready to Enrich")).toBeInTheDocument();
  });

  test("toggling a quick service chip adds/removes it (case-insensitively)", () => {
    renderDialog();
    // "Dubbing" pre-selected from lead.services
    const dubbingChip = screen.getByText(/Dubbing/).closest("button")!;
    expect(dubbingChip.textContent).toContain("✓");
    fireEvent.click(dubbingChip);
    expect(dubbingChip.textContent).not.toContain("✓");

    const subtitlingChip = screen.getByText(/Subtitling/).closest("button")!;
    expect(subtitlingChip.textContent).not.toContain("✓");
    fireEvent.click(subtitlingChip);
    expect(subtitlingChip.textContent).toContain("✓");
  });

  test("Save Draft calls onMarkEnriched with status 'pending' when no contact info", () => {
    const { onMarkEnriched, onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(onMarkEnriched).toHaveBeenCalledWith("lead1", expect.objectContaining({
      name: "Alex Chen",
      enrichment_status: "pending",
    }));
    expect(toast.success).toHaveBeenCalledWith("Draft changes saved.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("Save Draft marks 'complete' once contact info is present", () => {
    const { onMarkEnriched } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), { target: { value: "alex@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(onMarkEnriched).toHaveBeenCalledWith("lead1", expect.objectContaining({
      email: "alex@example.com",
      enrichment_status: "complete",
    }));
  });

  test("Mark as Enriched always sends status 'complete' and promotes", () => {
    const { onMarkEnriched, onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Mark as Enriched/ }));
    expect(onMarkEnriched).toHaveBeenCalledWith("lead1", expect.objectContaining({ enrichment_status: "complete" }));
    expect(toast.success).toHaveBeenCalledWith("Lead marked as Enriched! Alex Chen has been promoted.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("years of experience: blank clears the field, non-numeric becomes undefined", () => {
    const { onMarkEnriched } = renderDialog();
    const yearsInput = screen.getByPlaceholderText("e.g. 5");
    fireEvent.change(yearsInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(onMarkEnriched).toHaveBeenCalledWith("lead1", expect.objectContaining({ years_experience: undefined }));
  });

  test("all remaining text fields are editable and flow into the save payload", () => {
    const { onMarkEnriched } = renderDialog();
    fireEvent.change(screen.getByDisplayValue("Alex Chen"), { target: { value: "Alex C. Renamed" } });
    fireEvent.change(screen.getByDisplayValue("Germany"), { target: { value: "France" } });
    fireEvent.change(screen.getByPlaceholderText("https://www.linkedin.com/in/..."), { target: { value: "https://www.linkedin.com/in/alex" } });
    fireEvent.change(screen.getByDisplayValue("English"), { target: { value: "Japanese" } });
    fireEvent.change(screen.getByDisplayValue("German"), { target: { value: "Korean" } });
    fireEvent.change(screen.getByDisplayValue("Netflix, HBO"), { target: { value: "Disney, Amazon" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(onMarkEnriched).toHaveBeenCalledWith("lead1", expect.objectContaining({
      name: "Alex C. Renamed",
      country: "France",
      profile_link: "https://www.linkedin.com/in/alex",
      source_language: "Japanese",
      target_language: "Korean",
      vendor_experience: "Disney, Amazon",
    }));
  });

  test("re-opens with a different lead's data when `lead` prop changes", () => {
    const { rerender } = renderDialog();
    expect(screen.getByDisplayValue("Alex Chen")).toBeInTheDocument();
    rerender(
      <ManualEnrichmentDialog
        open
        onOpenChange={vi.fn()}
        lead={{ ...baseLead, id: "lead2", name: "Jamie Fox", years_experience: null, services: [] }}
        onMarkEnriched={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Jamie Fox")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Alex Chen")).not.toBeInTheDocument();
  });
});
