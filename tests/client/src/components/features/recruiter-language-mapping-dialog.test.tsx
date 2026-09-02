import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { RecruiterLanguageMappingDialog } from "@/components/features/recruiter-language-mapping-dialog";
import { api } from "@/lib/api";
import { toast } from "sonner";

vi.mock("@/lib/api", () => ({
  api: {
    getUsers: vi.fn(),
    createUser: vi.fn(),
    deactivateUser: vi.fn(),
    updateUserLanguages: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

function renderDialog(overrides: Partial<React.ComponentProps<typeof RecruiterLanguageMappingDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onOpenChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RecruiterLanguageMappingDialog open onOpenChange={onOpenChange} {...overrides} />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getUsers as any).mockResolvedValue({
    users: [
      { id: "r1", name: "Mathumitha", languages: ["Tamil", "Hindi"] },
      { id: "r2", name: "Divya", languages: [] },
    ],
  });
  window.confirm = vi.fn(() => true);
});

describe("RecruiterLanguageMappingDialog", () => {
  test("renders recruiters with their language badges", async () => {
    renderDialog();
    expect(await screen.findByText("Mathumitha")).toBeInTheDocument();
    expect(screen.getByText("Tamil")).toBeInTheDocument();
    expect(screen.getByText("Hindi")).toBeInTheDocument();
    expect(screen.getByText("No languages associated yet.")).toBeInTheDocument();
  });

  test("+ Add Recruiter toggles the inline form", async () => {
    renderDialog();
    await screen.findByText("Mathumitha");
    expect(screen.queryByText("Register New Recruiter")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /\+ Add Recruiter/ }));
    expect(screen.getByText("Register New Recruiter")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(screen.queryByText("Register New Recruiter")).not.toBeInTheDocument();
  });

  test("create recruiter validation: requires name", async () => {
    renderDialog();
    await screen.findByText("Mathumitha");
    fireEvent.click(screen.getByRole("button", { name: /\+ Add Recruiter/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add to Team/ }));
    expect(toast.error).toHaveBeenCalledWith("Please enter recruiter name");
    expect(api.createUser).not.toHaveBeenCalled();
  });

  test("create recruiter validation: requires email", async () => {
    renderDialog();
    await screen.findByText("Mathumitha");
    fireEvent.click(screen.getByRole("button", { name: /\+ Add Recruiter/ }));
    fireEvent.change(screen.getByPlaceholderText(/e.g. Mathumitha, Shivendra/), { target: { value: "Nina" } });
    fireEvent.click(screen.getByRole("button", { name: /Add to Team/ }));
    expect(toast.error).toHaveBeenCalledWith("Please enter recruiter email");
    expect(api.createUser).not.toHaveBeenCalled();
  });

  test("create recruiter with selected initial languages", async () => {
    (api.createUser as any).mockResolvedValue({ user: { id: "r3", name: "Nina", email: "nina@global3.io" } });
    renderDialog();
    await screen.findByText("Mathumitha");
    fireEvent.click(screen.getByRole("button", { name: /\+ Add Recruiter/ }));
    fireEvent.change(screen.getByPlaceholderText(/e.g. Mathumitha, Shivendra/), { target: { value: "Nina" } });
    fireEvent.change(screen.getByPlaceholderText("name@global3.io"), { target: { value: "nina@global3.io" } });
    fireEvent.click(screen.getByRole("button", { name: "+ French" }));
    fireEvent.click(screen.getByRole("button", { name: "+ German" }));
    fireEvent.click(screen.getByRole("button", { name: /Add to Team/ }));

    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith({
      name: "Nina", email: "nina@global3.io", role: "RECRUITER", languages: ["French", "German"],
    }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('Recruiter "Nina" added.'),
      expect.objectContaining({ duration: 12000 }),
    ));
  });

  test("create recruiter error shows toast", async () => {
    (api.createUser as any).mockRejectedValue(new Error("Email already in use"));
    renderDialog();
    await screen.findByText("Mathumitha");
    fireEvent.click(screen.getByRole("button", { name: /\+ Add Recruiter/ }));
    fireEvent.change(screen.getByPlaceholderText(/e.g. Mathumitha, Shivendra/), { target: { value: "Nina" } });
    fireEvent.change(screen.getByPlaceholderText("name@global3.io"), { target: { value: "nina@global3.io" } });
    fireEvent.click(screen.getByRole("button", { name: /Add to Team/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Email already in use"));
  });

  test("Edit panel: quick-add a common language", async () => {
    (api.updateUserLanguages as any).mockResolvedValue({ user: { id: "r2", name: "Divya", languages: ["French"] } });
    renderDialog();
    await screen.findByText("Divya");
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[1]); // Divya has no languages -> second recruiter
    fireEvent.click(screen.getByRole("button", { name: /French/ }));
    await waitFor(() => expect(api.updateUserLanguages).toHaveBeenCalledWith("r2", ["French"]));
    expect(toast.success).toHaveBeenCalledWith('Added "French" to recruiter profile');
  });

  test("Edit panel: add custom language via Enter key", async () => {
    (api.updateUserLanguages as any).mockResolvedValue({ user: { id: "r2", name: "Divya", languages: ["Klingon"] } });
    renderDialog();
    await screen.findByText("Divya");
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[1]);
    const input = screen.getByPlaceholderText("Type custom language…");
    fireEvent.change(input, { target: { value: "Klingon" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.updateUserLanguages).toHaveBeenCalledWith("r2", ["Klingon"]));
  });

  test("duplicate language (case-insensitive) is not re-added", async () => {
    renderDialog();
    await screen.findByText("Mathumitha");
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[0]); // Mathumitha already has "Tamil"
    const input = screen.getByPlaceholderText("Type custom language…");
    fireEvent.change(input, { target: { value: "tamil" } });
    fireEvent.click(screen.getByRole("button", { name: /Add$/ }));
    expect(api.updateUserLanguages).not.toHaveBeenCalled();
  });

  test("remove a language badge", async () => {
    (api.updateUserLanguages as any).mockResolvedValue({ user: { id: "r1", name: "Mathumitha", languages: ["Hindi"] } });
    renderDialog();
    await screen.findByText("Mathumitha");
    const tamilBadge = screen.getByText("Tamil").closest("span")!;
    fireEvent.click(tamilBadge.querySelector("button")!);
    await waitFor(() => expect(api.updateUserLanguages).toHaveBeenCalledWith("r1", ["Hindi"]));
    expect(toast.info).toHaveBeenCalledWith('Removed "Tamil"');
  });

  test("deactivate recruiter after confirm", async () => {
    (api.deactivateUser as any).mockResolvedValue({ user: { id: "r1" } });
    renderDialog();
    await screen.findByText("Mathumitha");
    const deactivateButtons = screen.getAllByTitle(/Deactivate/);
    fireEvent.click(deactivateButtons[0]);
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.deactivateUser).toHaveBeenCalledWith("r1"));
    expect(toast.success).toHaveBeenCalledWith("Deactivated recruiter Mathumitha");
  });

  test("deactivate recruiter: cancelling confirm skips the call", async () => {
    (window.confirm as any).mockReturnValue(false);
    renderDialog();
    await screen.findByText("Mathumitha");
    const deactivateButtons = screen.getAllByTitle(/Deactivate/);
    fireEvent.click(deactivateButtons[0]);
    expect(api.deactivateUser).not.toHaveBeenCalled();
  });
});
