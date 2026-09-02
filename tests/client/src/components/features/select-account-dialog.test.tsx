import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SelectAccountDialog } from "@/components/features/select-account-dialog";

const accounts = [
  { id: "a1", unipileAccountId: "u1", accountName: "Alex LinkedIn", provider: "LINKEDIN", status: "OK" },
  { id: "a2", unipileAccountId: "u2", accountName: "Alex Work", provider: "LINKEDIN", status: "OK" },
];

function renderDialog(overrides: Partial<React.ComponentProps<typeof SelectAccountDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onSelectAccount = vi.fn();
  const utils = render(
    <SelectAccountDialog
      open
      onOpenChange={onOpenChange}
      accounts={accounts}
      channel="LINKEDIN"
      onSelectAccount={onSelectAccount}
      {...overrides}
    />,
  );
  return { ...utils, onOpenChange, onSelectAccount };
}

describe("SelectAccountDialog", () => {
  test("renders all accounts and preselects the first", () => {
    renderDialog();
    expect(screen.getByText("Alex LinkedIn")).toBeInTheDocument();
    expect(screen.getByText("Alex Work")).toBeInTheDocument();
    // only the first account's card should show the check icon initially
    expect(document.querySelectorAll(".lucide-circle-check").length).toBe(1);
  });

  test("clicking an account card selects it", () => {
    renderDialog();
    fireEvent.click(screen.getByText("Alex Work"));
    expect(document.querySelectorAll(".lucide-circle-check").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /Send Message/ }));
  });

  test("confirm calls onSelectAccount with the selected account id", () => {
    const { onSelectAccount } = renderDialog();
    fireEvent.click(screen.getByText("Alex Work"));
    fireEvent.click(screen.getByRole("button", { name: /Send Message/ }));
    expect(onSelectAccount).toHaveBeenCalledWith("u2");
  });

  test("confirm without changing selection uses the first account", () => {
    const { onSelectAccount } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Send Message/ }));
    expect(onSelectAccount).toHaveBeenCalledWith("u1");
  });

  test("cancel button calls onOpenChange(false)", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("isSending shows a Sending… label", () => {
    renderDialog({ isSending: true });
    expect(screen.getByText("Sending…")).toBeInTheDocument();
  });

  test("EMAIL channel changes description wording", () => {
    renderDialog({ channel: "EMAIL" });
    expect(screen.getByText(/multiple connected Email accounts/)).toBeInTheDocument();
  });

  test("empty accounts list disables the send button", () => {
    const { onSelectAccount } = renderDialog({ accounts: [] });
    const sendBtn = screen.getByRole("button", { name: /Send Message/ });
    expect(sendBtn).toBeDisabled();
    fireEvent.click(sendBtn);
    expect(onSelectAccount).not.toHaveBeenCalled();
  });
});
