import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ConnectAccountDialog } from "@/components/features/connect-account-dialog";
import { api } from "@/lib/api";
import { toast } from "sonner";

vi.mock("@/lib/api", () => ({
  api: {
    getConnectedAccounts: vi.fn(),
    disconnectAccount: vi.fn(),
    connectAccount: vi.fn(),
    cancelPendingConnection: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

function renderDialog(overrides: Partial<React.ComponentProps<typeof ConnectAccountDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onOpenChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ConnectAccountDialog open onOpenChange={onOpenChange} {...overrides} />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getConnectedAccounts as any).mockResolvedValue([]);
  vi.spyOn(window, "open").mockReturnValue(null);
});

describe("ConnectAccountDialog", () => {
  test("renders with no accounts connected", async () => {
    renderDialog();
    expect(screen.getByText("Connected Outreach Accounts")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Connect/ }).length).toBe(2));
  });

  test("shows LinkedIn account as connected with Remove action", async () => {
    (api.getConnectedAccounts as any).mockResolvedValue([
      { unipileAccountId: "li1", provider: "LINKEDIN", status: "CONNECTED", accountName: "Alex on LinkedIn" },
    ]);
    renderDialog();
    expect(await screen.findByText("Alex on LinkedIn")).toBeInTheDocument();
    const badges = screen.getAllByText("Connected");
    expect(badges.length).toBe(1);
    expect(screen.getByRole("button", { name: /Remove/ })).toBeInTheDocument();
  });

  test("shows Email account as connected independent of LinkedIn", async () => {
    (api.getConnectedAccounts as any).mockResolvedValue([
      { unipileAccountId: "em1", provider: "GOOGLE", status: "CONNECTED", accountName: "alex@gmail.com" },
    ]);
    renderDialog();
    expect(await screen.findByText("alex@gmail.com")).toBeInTheDocument();
  });

  test("disconnected accounts are treated as not connected", async () => {
    (api.getConnectedAccounts as any).mockResolvedValue([
      { unipileAccountId: "li1", provider: "LINKEDIN", status: "DISCONNECTED", accountName: "Old LinkedIn" },
    ]);
    renderDialog();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Connect/ }).length).toBe(2));
    expect(screen.queryByText("Old LinkedIn")).not.toBeInTheDocument();
  });

  test("connect LinkedIn opens a popup with the returned url", async () => {
    (api.connectAccount as any).mockResolvedValue({ url: "https://unipile.example.com/auth/li" });
    renderDialog();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Connect/ }).length).toBe(2));
    fireEvent.click(screen.getAllByRole("button", { name: /Connect/ })[0]);
    await waitFor(() => expect(api.connectAccount).toHaveBeenCalledWith("LINKEDIN"));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith(
      "https://unipile.example.com/auth/li", "_blank", "width=600,height=700",
    ));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Opening Unipile connection window for LINKEDIN"),
    ));
  });

  test("connect failure with generic error shows toast", async () => {
    (api.connectAccount as any).mockRejectedValue(new Error("Unipile is down"));
    renderDialog();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Connect/ }).length).toBe(2));
    fireEvent.click(screen.getAllByRole("button", { name: /Connect/ })[1]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unipile is down"));
  });

  test("CONNECTION_PENDING error surfaces a Cancel and retry action", async () => {
    const pendingErr: any = new Error("A connection attempt is already pending.");
    pendingErr.code = "CONNECTION_PENDING";
    (api.connectAccount as any).mockRejectedValue(pendingErr);
    renderDialog();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Connect/ }).length).toBe(2));
    fireEvent.click(screen.getAllByRole("button", { name: /Connect/ })[0]);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      "A connection attempt is already pending.",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Cancel and retry" }),
      }),
    ));
  });

  test("Cancel and retry action cancels then reconnects", async () => {
    const pendingErr: any = new Error("pending");
    pendingErr.code = "CONNECTION_PENDING";
    (api.connectAccount as any).mockRejectedValueOnce(pendingErr).mockResolvedValueOnce({ url: "https://retry.example.com" });
    (api.cancelPendingConnection as any).mockResolvedValue({ success: true });
    renderDialog();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Connect/ }).length).toBe(2));
    fireEvent.click(screen.getAllByRole("button", { name: /Connect/ })[0]);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const call = (toast.error as any).mock.calls.find((c: any[]) => c[1]?.action);
    await call[1].action.onClick();

    expect(api.cancelPendingConnection).toHaveBeenCalledWith("LINKEDIN");
    await waitFor(() => expect(api.connectAccount).toHaveBeenCalledTimes(2));
  });

  test("disconnect removes an account and invalidates queries", async () => {
    (api.getConnectedAccounts as any).mockResolvedValue([
      { unipileAccountId: "li1", provider: "LINKEDIN", status: "CONNECTED", accountName: "Alex" },
    ]);
    (api.disconnectAccount as any).mockResolvedValue({ success: true });
    renderDialog();
    const removeBtn = await screen.findByRole("button", { name: /Remove/ });
    fireEvent.click(removeBtn);
    await waitFor(() => expect(api.disconnectAccount).toHaveBeenCalledWith("li1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Account disconnected successfully"));
  });

  test("disconnect failure shows error toast", async () => {
    (api.getConnectedAccounts as any).mockResolvedValue([
      { unipileAccountId: "li1", provider: "LINKEDIN", status: "CONNECTED", accountName: "Alex" },
    ]);
    (api.disconnectAccount as any).mockRejectedValue(new Error("Could not disconnect"));
    renderDialog();
    const removeBtn = await screen.findByRole("button", { name: /Remove/ });
    fireEvent.click(removeBtn);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not disconnect"));
  });

  test("refresh button refetches connected accounts", async () => {
    renderDialog();
    const refreshBtn = await screen.findByRole("button", { name: /Refresh/ });
    fireEvent.click(refreshBtn);
    await waitFor(() => expect(api.getConnectedAccounts).toHaveBeenCalledTimes(2));
  });

  test("disconnect removes the email account specifically", async () => {
    (api.getConnectedAccounts as any).mockResolvedValue([
      { unipileAccountId: "li1", provider: "LINKEDIN", status: "CONNECTED", accountName: "Alex LI" },
      { unipileAccountId: "em1", provider: "OUTLOOK", status: "CONNECTED", accountName: "alex@outlook.com" },
    ]);
    (api.disconnectAccount as any).mockResolvedValue({ success: true });
    renderDialog();
    await screen.findByText("alex@outlook.com");
    const removeButtons = screen.getAllByRole("button", { name: /Remove/ });
    fireEvent.click(removeButtons[1]);
    await waitFor(() => expect(api.disconnectAccount).toHaveBeenCalledWith("em1"));
  });

  test("Cancel and retry: cancelPendingConnection itself failing shows its own error toast", async () => {
    const pendingErr: any = new Error("pending");
    pendingErr.code = "CONNECTION_PENDING";
    (api.connectAccount as any).mockRejectedValue(pendingErr);
    (api.cancelPendingConnection as any).mockRejectedValue(new Error("Could not cancel"));
    renderDialog();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Connect/ }).length).toBe(2));
    fireEvent.click(screen.getAllByRole("button", { name: /Connect/ })[0]);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const call = (toast.error as any).mock.calls.find((c: any[]) => c[1]?.action);
    await call[1].action.onClick();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not cancel"));
  });

  test("abandoned popup: reconnected in the background just refetches, no cancel", async () => {
    vi.useFakeTimers();
    try {
      (api.connectAccount as any).mockResolvedValue({ url: "https://unipile.example.com/auth/li" });
      const popup = { closed: false } as Window;
      vi.spyOn(window, "open").mockReturnValue(popup);
      renderDialog();
      await vi.waitFor(() => expect(screen.getAllByRole("button", { name: /Connect/ }).length).toBe(2));
      fireEvent.click(screen.getAllByRole("button", { name: /Connect/ })[0]);
      await vi.waitFor(() => expect(api.connectAccount).toHaveBeenCalled());

      (popup as any).closed = true;
      (api.getConnectedAccounts as any).mockResolvedValue([
        { unipileAccountId: "li1", provider: "LINKEDIN", status: "CONNECTED", accountName: "Alex" },
      ]);
      await vi.advanceTimersByTimeAsync(1_000); // poll notices popup.closed
      await vi.advanceTimersByTimeAsync(6_000); // abandonment grace period elapses

      expect(api.cancelPendingConnection).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("abandoned popup: still unconnected after grace period cancels the pending attempt", async () => {
    vi.useFakeTimers();
    try {
      (api.connectAccount as any).mockResolvedValue({ url: "https://unipile.example.com/auth/li" });
      (api.cancelPendingConnection as any).mockResolvedValue({ success: true });
      const popup = { closed: false } as Window;
      vi.spyOn(window, "open").mockReturnValue(popup);
      renderDialog();
      await vi.waitFor(() => expect(screen.getAllByRole("button", { name: /Connect/ }).length).toBe(2));
      fireEvent.click(screen.getAllByRole("button", { name: /Connect/ })[0]);
      await vi.waitFor(() => expect(api.connectAccount).toHaveBeenCalled());

      (popup as any).closed = true;
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(6_000);

      expect(api.cancelPendingConnection).toHaveBeenCalledWith("LINKEDIN");
    } finally {
      vi.useRealTimers();
    }
  });
});
