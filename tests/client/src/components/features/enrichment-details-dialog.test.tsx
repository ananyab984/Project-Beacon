import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { EnrichmentDetailsDialog } from "@/components/features/enrichment-details-dialog";
import type { ApiLead } from "@/lib/api-types";

const baseLead = {
  id: "lead1",
  displayName: "Alex Chen",
  fullName: "Alex Chen",
  email: "alex@example.com",
  contactNumber: "+1 555 0100",
  country: "Germany",
  headline: "Senior Dubbing Artist",
  currentTitle: "Voice Actor",
  aboutSnippet: "10 years in the industry",
  yearsOfExperience: 8,
  vendorExperience: "Netflix",
  toolsSoftware: ["Pro Tools", "Reaper"],
  certifications: [],
  fieldSources: { Email_Address: "brightdata", Years_of_Exp: "clay" },
  clayData: {
    experience: [{ title: "Voice Actor", company: "Netflix", startDate: "2020", endDate: null }],
    education: [{ degree: "BA Theatre", institution: "Not specified" }],
    languages: ["German", { language: "English" }],
    courses: ["Advanced Dubbing"],
  },
} as unknown as ApiLead;

function renderDialog(overrides: Partial<React.ComponentProps<typeof EnrichmentDetailsDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onSave = vi.fn();
  const utils = render(
    <EnrichmentDetailsDialog open onOpenChange={onOpenChange} lead={baseLead} onSave={onSave} {...overrides} />,
  );
  return { ...utils, onOpenChange, onSave };
}

describe("EnrichmentDetailsDialog", () => {
  test("renders null when there is no lead", () => {
    const { container } = render(
      <EnrichmentDetailsDialog open onOpenChange={vi.fn()} lead={null} onSave={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("prefills known fields and shows source badges", () => {
    renderDialog();
    expect(screen.getByDisplayValue("alex@example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("+1 555 0100")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pro Tools, Reaper")).toBeInTheDocument();
    expect(screen.getByText("Bright Data")).toBeInTheDocument();
    expect(screen.getAllByText("Clay").length).toBeGreaterThan(0);
  });

  test("no 'No contact yet' badge when email/contact present", () => {
    renderDialog();
    expect(screen.queryByText("No contact yet")).not.toBeInTheDocument();
  });

  test("shows 'No contact yet' badge and manual-followup note when both are missing", () => {
    renderDialog({ lead: { ...baseLead, email: null, contactNumber: null } as any });
    expect(screen.getByText("No contact yet")).toBeInTheDocument();
    expect(screen.getByText(/no email or contact number was found/)).toBeInTheDocument();
  });

  test("renders experience, education, languages, and courses from Clay data", () => {
    renderDialog();
    expect(screen.getByText("Voice Actor at Netflix (2020–present)")).toBeInTheDocument();
    expect(screen.getByText("BA Theatre")).toBeInTheDocument();
    expect(screen.getByText("German, English")).toBeInTheDocument();
    expect(screen.getByText("Advanced Dubbing")).toBeInTheDocument();
  });

  test("editing a field and saving builds the correct patch", () => {
    const { onSave, onOpenChange } = renderDialog();
    fireEvent.change(screen.getByDisplayValue("alex@example.com"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByDisplayValue("Pro Tools, Reaper"), { target: { value: "Pro Tools, Reaper, Audacity" } });
    fireEvent.change(screen.getByDisplayValue("8"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith("lead1", expect.objectContaining({
      email: "new@example.com",
      toolsSoftware: ["Pro Tools", "Reaper", "Audacity"],
      yearsOfExperience: 12,
      certifications: [],
    }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("clearing a number field sends undefined, not NaN", () => {
    const { onSave } = renderDialog();
    fireEvent.change(screen.getByDisplayValue("8"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("lead1", expect.objectContaining({ yearsOfExperience: undefined }));
  });

  test("re-hydrates fields when the lead prop changes", () => {
    const { rerender } = renderDialog();
    expect(screen.getByDisplayValue("alex@example.com")).toBeInTheDocument();
    rerender(
      <EnrichmentDetailsDialog
        open
        onOpenChange={vi.fn()}
        lead={{ ...baseLead, id: "lead2", email: "other@example.com" } as any}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("other@example.com")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("alex@example.com")).not.toBeInTheDocument();
  });

  test("falls back gracefully for missing/malformed Clay entries", () => {
    renderDialog({
      lead: {
        ...baseLead,
        clayData: { experience: [{}], education: [null], languages: [123], courses: null },
      } as any,
    });
    // Should not throw; no experience/education section rendered since formatRole/formatEducation
    // both return "" for the malformed entries above.
    expect(screen.queryByText("Experience & Education")).not.toBeInTheDocument();
  });
});
