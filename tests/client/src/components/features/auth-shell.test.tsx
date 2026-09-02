import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthShell } from "@/components/features/auth-shell";

describe("AuthShell", () => {
  it("renders the title, children, and the Global3 wordmark", () => {
    render(
      <AuthShell title="Sign in">
        <div>form goes here</div>
      </AuthShell>,
    );
    expect(screen.getByText("Sign in")).toBeInTheDocument();
    expect(screen.getByText("form goes here")).toBeInTheDocument();
    expect(screen.getAllByText("Global").length).toBeGreaterThan(0);
  });

  it("omits the subtitle when not provided", () => {
    render(<AuthShell title="Sign in">content</AuthShell>);
    expect(screen.queryByText(/./, { selector: "p.mt-2" })).not.toBeInTheDocument();
  });

  it("renders the subtitle when provided", () => {
    render(
      <AuthShell title="Sign in" subtitle="Welcome back">
        content
      </AuthShell>,
    );
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
  });

  it("omits the footer when not provided", () => {
    render(<AuthShell title="Sign in">content</AuthShell>);
    expect(screen.queryByText("footer copy")).not.toBeInTheDocument();
  });

  it("renders the footer when provided", () => {
    render(
      <AuthShell title="Sign in" footer={<span>footer copy</span>}>
        content
      </AuthShell>,
    );
    expect(screen.getByText("footer copy")).toBeInTheDocument();
  });
});
