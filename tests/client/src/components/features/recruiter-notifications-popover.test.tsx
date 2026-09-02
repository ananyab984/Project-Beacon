import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseQuery } = vi.hoisted(() => ({ mockUseQuery: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({ useQuery: mockUseQuery }));
vi.mock("@/lib/api", () => ({ api: { getEscalations: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={typeof to === "string" ? to : "#"} {...props}>
      {children}
    </a>
  ),
}));

import { RecruiterNotificationsPopover } from "@/components/features/recruiter-notifications-popover";

function escalation(overrides: Partial<{ id: string; title: string; category: string; detail: string; createdAt: string }> = {}) {
  return {
    id: "esc-1",
    title: "Reply overdue",
    category: "Recruiter Performance",
    detail: "This lead has not been contacted in 5 days.",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  mockUseQuery.mockReset();
  mockUseQuery.mockReturnValue({ data: { escalations: [] } });
});

describe("RecruiterNotificationsPopover", () => {
  it("shows no unread badge when there are no escalations", () => {
    render(<RecruiterNotificationsPopover />);
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("shows the unread count badge when escalations are present", () => {
    mockUseQuery.mockReturnValue({ data: { escalations: [escalation({ id: "a" }), escalation({ id: "b" })] } });
    render(<RecruiterNotificationsPopover />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("handles a missing data payload gracefully (no escalations)", () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    render(<RecruiterNotificationsPopover />);
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("shows the empty state inside the popover when there are no escalations", async () => {
    const user = userEvent.setup();
    render(<RecruiterNotificationsPopover />);
    await user.click(screen.getByTitle("Notifications"));
    expect(await screen.findByText("No escalated items right now.")).toBeInTheDocument();
  });

  it("lists escalation notifications with title, category and detail", async () => {
    mockUseQuery.mockReturnValue({ data: { escalations: [escalation()] } });
    const user = userEvent.setup();
    render(<RecruiterNotificationsPopover />);
    await user.click(screen.getByTitle("Notifications"));
    expect(await screen.findByText("Reply overdue")).toBeInTheDocument();
    expect(screen.getByText("Recruiter Performance")).toBeInTheDocument();
    expect(screen.getByText("This lead has not been contacted in 5 days.")).toBeInTheDocument();
  });

  it("marks all notifications read as soon as the popover opens, clearing the badge", async () => {
    mockUseQuery.mockReturnValue({ data: { escalations: [escalation({ id: "a" })] } });
    const user = userEvent.setup();
    render(<RecruiterNotificationsPopover />);
    expect(screen.getByText("1")).toBeInTheDocument();
    await user.click(screen.getByTitle("Notifications"));
    await screen.findByText("Reply overdue");
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("links to the email queue for an 'Email Queue Threshold Alert' escalation", async () => {
    mockUseQuery.mockReturnValue({
      data: { escalations: [escalation({ category: "Email Queue Threshold Alert" })] },
    });
    const user = userEvent.setup();
    render(<RecruiterNotificationsPopover />);
    await user.click(screen.getByTitle("Notifications"));
    const link = await screen.findByText("Review email queue");
    expect(link.closest("a")).toHaveAttribute("href", "/recruiter/email-queue");
  });

  it("links to performance for a 'Recruiter Performance' escalation", async () => {
    mockUseQuery.mockReturnValue({
      data: { escalations: [escalation({ category: "Recruiter Performance" })] },
    });
    const user = userEvent.setup();
    render(<RecruiterNotificationsPopover />);
    await user.click(screen.getByTitle("Notifications"));
    const link = await screen.findByText("View performance");
    expect(link.closest("a")).toHaveAttribute("href", "/recruiter/performance");
  });

  it("falls back to reviewing the lead for any other escalation category", async () => {
    mockUseQuery.mockReturnValue({
      data: { escalations: [escalation({ category: "Something Else" })] },
    });
    const user = userEvent.setup();
    render(<RecruiterNotificationsPopover />);
    await user.click(screen.getByTitle("Notifications"));
    const link = await screen.findByText("Review lead");
    expect(link.closest("a")).toHaveAttribute("href", "/recruiter/leads");
  });

  it("renders a footer link to view all pending leads", async () => {
    const user = userEvent.setup();
    render(<RecruiterNotificationsPopover />);
    await user.click(screen.getByTitle("Notifications"));
    const link = await screen.findByText("View all pending leads");
    expect(link.closest("a")).toHaveAttribute("href", "/recruiter/leads");
  });

  it("shows an age label of 'Today' for a just-created escalation", async () => {
    mockUseQuery.mockReturnValue({ data: { escalations: [escalation({ createdAt: new Date().toISOString() })] } });
    const user = userEvent.setup();
    render(<RecruiterNotificationsPopover />);
    await user.click(screen.getByTitle("Notifications"));
    expect(await screen.findByText("Today")).toBeInTheDocument();
  });

  it("closes when Escape is pressed, without erroring on the close path", async () => {
    mockUseQuery.mockReturnValue({ data: { escalations: [escalation()] } });
    const user = userEvent.setup();
    render(<RecruiterNotificationsPopover />);
    await user.click(screen.getByTitle("Notifications"));
    await screen.findByText("Reply overdue");
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Reply overdue")).not.toBeInTheDocument();
  });

  it("shows a '<n>d ago' age label for an older escalation", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    mockUseQuery.mockReturnValue({ data: { escalations: [escalation({ createdAt: threeDaysAgo })] } });
    const user = userEvent.setup();
    render(<RecruiterNotificationsPopover />);
    await user.click(screen.getByTitle("Notifications"));
    expect(await screen.findByText("3d ago")).toBeInTheDocument();
  });
});
