import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LeadCard } from "@/components/features/lead-card";
import type { ApiLead, ApiUser } from "@/lib/api-types";

function makeLead(overrides: Partial<ApiLead> = {}): ApiLead {
  return {
    id: "lead-1",
    displayName: "Jane Doe",
    fullName: "Jane Doe",
    maskedLabel: null,
    targetLanguage: "French",
    sourceLanguage: "English",
    source: "LINKEDIN",
    stage: "NEW",
    services: ["Dubbing", "Subtitling"],
    flags: [],
    assignedRecruiterId: null,
    availability: "AVAILABLE_NOW",
    emailVerified: true,
    lastActivityAt: "2026-01-15T00:00:00.000Z",
    identityResolved: true,
    ...overrides,
  } as ApiLead;
}

const recruiters: ApiUser[] = [
  { id: "rec-1", name: "Alex Recruiter" } as ApiUser,
];

describe("LeadCard", () => {
  it("renders the display name, language and source", () => {
    render(<LeadCard lead={makeLead()} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("French")).toBeInTheDocument();
    expect(screen.getByText("LINKEDIN")).toBeInTheDocument();
  });

  it("falls back from displayName to fullName to maskedLabel to em-dash", () => {
    render(<LeadCard lead={makeLead({ displayName: null, fullName: "Full Name Only" })} />);
    expect(screen.getByText("Full Name Only")).toBeInTheDocument();

    render(<LeadCard lead={makeLead({ displayName: null, fullName: null, maskedLabel: "J. D." })} />);
    expect(screen.getByText("J. D.")).toBeInTheDocument();

    render(<LeadCard lead={makeLead({ displayName: null, fullName: null, maskedLabel: null })} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("falls back from targetLanguage to sourceLanguage to em-dash", () => {
    render(<LeadCard lead={makeLead({ targetLanguage: null, sourceLanguage: "Spanish" })} />);
    expect(screen.getByText("Spanish")).toBeInTheDocument();
  });

  it("shows em-dash when both targetLanguage and sourceLanguage are missing", () => {
    render(<LeadCard lead={makeLead({ targetLanguage: null, sourceLanguage: null })} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the unresolved identity badge only when identityResolved is false", () => {
    const { rerender } = render(<LeadCard lead={makeLead({ identityResolved: true })} />);
    expect(screen.queryByText("unresolved identity")).not.toBeInTheDocument();
    rerender(<LeadCard lead={makeLead({ identityResolved: false })} />);
    expect(screen.getByText("unresolved identity")).toBeInTheDocument();
  });

  it("shows the assigned recruiter's name when found in the recruiters list", () => {
    render(<LeadCard lead={makeLead({ assignedRecruiterId: "rec-1" })} recruiters={recruiters} />);
    expect(screen.getByText("Alex Recruiter")).toBeInTheDocument();
  });

  it("omits recruiter name when assignedRecruiterId doesn't match any recruiter", () => {
    render(<LeadCard lead={makeLead({ assignedRecruiterId: "missing" })} recruiters={recruiters} />);
    expect(screen.queryByText("Alex Recruiter")).not.toBeInTheDocument();
  });

  it("renders the lead stage badge", () => {
    render(<LeadCard lead={makeLead({ stage: "REPLIED" })} />);
    expect(screen.getByText("REPLIED")).toBeInTheDocument();
  });

  it("renders every service chip", () => {
    render(<LeadCard lead={makeLead({ services: ["A", "B", "C"] })} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("renders the availability/verified-email/last-activity grid when not compact", () => {
    render(<LeadCard lead={makeLead()} />);
    expect(screen.getByText("AVAILABLE_NOW")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getByText(new Date("2026-01-15T00:00:00.000Z").toLocaleDateString())).toBeInTheDocument();
  });

  it("shows 'no' for an unverified email and em-dash for a missing lastActivityAt", () => {
    render(<LeadCard lead={makeLead({ emailVerified: false, lastActivityAt: null })} />);
    expect(screen.getByText("no")).toBeInTheDocument();
  });

  it("hides the detail grid when compact is true", () => {
    render(<LeadCard lead={makeLead()} compact />);
    expect(screen.queryByText("availability")).not.toBeInTheDocument();
  });

  it("renders flag badges when flags are present, and none when empty", () => {
    const { rerender } = render(<LeadCard lead={makeLead({ flags: ["DNC", "HIGH_PRIORITY"] })} />);
    expect(screen.getByText("DNC")).toBeInTheDocument();
    expect(screen.getByText("HIGH_PRIORITY")).toBeInTheDocument();

    rerender(<LeadCard lead={makeLead({ flags: [] })} />);
    expect(screen.queryByText("DNC")).not.toBeInTheDocument();
  });

  it("styles the WATCHING and ON_HOLD flags", () => {
    render(<LeadCard lead={makeLead({ flags: ["WATCHING", "ON_HOLD"] })} />);
    expect(screen.getByText("WATCHING")).toBeInTheDocument();
    expect(screen.getByText("ON_HOLD")).toBeInTheDocument();
  });
});
