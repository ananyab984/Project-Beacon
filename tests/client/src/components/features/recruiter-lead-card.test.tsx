import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LeadDetailSheet, isJustEnriched } from "@/components/features/recruiter-lead-card";
import type { RecruiterLead } from "@/lib/recruiter-mock";

// Note: this file is named recruiter-lead-card.tsx but actually exports
// LeadDetailSheet (a lead-detail Sheet panel) and isJustEnriched, not a
// "recruiter lead card" component. Tests target the real exports.

function makeLead(overrides: Partial<RecruiterLead> = {}): RecruiterLead {
  return {
    id: "lead-1",
    owner_recruiter_id: "rec-1",
    reachout_date: "2026-01-01",
    application_date: "2026-01-02",
    first_name: "Jane",
    full_name: "Jane Doe",
    country_of_residence: "Canada",
    source: "LinkedIn",
    profile_link: "https://linkedin.com/in/janedoe",
    contact_number: "555-1234",
    email_address: "jane@example.com",
    services: ["Dubbing"],
    source_language: "English",
    target_language: "French",
    secondary_languages: ["Spanish"],
    years_of_exp: 5,
    vendor_experience: "Netflix",
    enrichment_status: "complete",
    just_enriched_until: null,
    created_at: Date.now(),
    ...overrides,
  };
}

describe("isJustEnriched", () => {
  it("is true when just_enriched_until is in the future", () => {
    expect(isJustEnriched(makeLead({ just_enriched_until: Date.now() + 10_000 }))).toBe(true);
  });

  it("is false when null or in the past", () => {
    expect(isJustEnriched(makeLead({ just_enriched_until: null }))).toBe(false);
    expect(isJustEnriched(makeLead({ just_enriched_until: Date.now() - 10_000 }))).toBe(false);
  });
});

describe("LeadDetailSheet", () => {
  it("renders nothing lead-specific when lead is null", () => {
    render(<LeadDetailSheet lead={null} open onOpenChange={() => {}} />);
    expect(screen.queryByText("Capture")).not.toBeInTheDocument();
  });

  it("renders the full name and capture fields when open with a lead", () => {
    render(<LeadDetailSheet lead={makeLead()} open onOpenChange={() => {}} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Canada")).toBeInTheDocument();
    expect(screen.getByText("LinkedIn")).toBeInTheDocument();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
  });

  it("shows em-dash placeholders for missing capture fields", () => {
    render(
      <LeadDetailSheet
        lead={makeLead({ country_of_residence: "", profile_link: "", email_address: "", contact_number: "", reachout_date: null, application_date: null })}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(5);
  });

  it("shows the 'Just enriched' badge only when isJustEnriched is true", () => {
    const { rerender } = render(
      <LeadDetailSheet lead={makeLead({ just_enriched_until: Date.now() + 60_000 })} open onOpenChange={() => {}} />,
    );
    expect(screen.getByText("Just enriched")).toBeInTheDocument();

    rerender(<LeadDetailSheet lead={makeLead({ just_enriched_until: null })} open onOpenChange={() => {}} />);
    expect(screen.queryByText("Just enriched")).not.toBeInTheDocument();
  });

  it("shows skeletons and an 'Enriching…' heading while pending", () => {
    render(
      <LeadDetailSheet lead={makeLead({ enrichment_status: "pending" })} open onOpenChange={() => {}} />,
    );
    expect(screen.getByText("Enriching…")).toBeInTheDocument();
    // Sheet content is rendered into a portal on document.body, not the local container.
    expect(document.body.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("Services")).not.toBeInTheDocument();
  });

  it("shows enriched fields and an 'Enriched' heading when complete", () => {
    render(<LeadDetailSheet lead={makeLead({ enrichment_status: "complete" })} open onOpenChange={() => {}} />);
    expect(screen.getByText("Enriched")).toBeInTheDocument();
    expect(screen.getByText("Dubbing")).toBeInTheDocument();
    expect(screen.getByText("French")).toBeInTheDocument();
    expect(screen.getByText("Spanish")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Netflix")).toBeInTheDocument();
  });

  it("falls back to em-dash for missing enriched fields", () => {
    render(
      <LeadDetailSheet
        lead={makeLead({ source_language: null, target_language: null, secondary_languages: null, years_of_exp: null, vendor_experience: null })}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });
});
