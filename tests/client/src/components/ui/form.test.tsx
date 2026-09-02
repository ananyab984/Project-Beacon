import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const schema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
});

function TestForm({ onSubmit = vi.fn(), withDescription = false }: { onSubmit?: (v: unknown) => void; withDescription?: boolean }) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { username: "" },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              {withDescription && <FormDescription>Your public display name.</FormDescription>}
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="submit">Submit</button>
      </form>
    </Form>
  );
}

describe("Form", () => {
  it("renders label associated to the input via htmlFor/id", () => {
    render(<TestForm />);
    const input = screen.getByLabelText("Username");
    const label = screen.getByText("Username");
    expect(input.id).toBe(label.getAttribute("for"));
  });

  it("sets aria-describedby to the description id when no error", () => {
    render(<TestForm withDescription />);
    const input = screen.getByLabelText("Username");
    const description = screen.getByText("Your public display name.");
    expect(input).toHaveAttribute("aria-describedby", description.id);
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("shows a validation FormMessage after a failed submit", async () => {
    const user = userEvent.setup();
    render(<TestForm />);
    await user.click(screen.getByText("Submit"));
    expect(await screen.findByText("Username must be at least 3 characters")).toBeInTheDocument();
  });

  it("marks the input invalid and updates aria-describedby to include the message id after error", async () => {
    const user = userEvent.setup();
    render(<TestForm withDescription />);
    await user.click(screen.getByText("Submit"));
    const message = await screen.findByText("Username must be at least 3 characters");
    const input = screen.getByLabelText("Username");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(message.id);
  });

  it("applies destructive text class to the label when there is an error", async () => {
    const user = userEvent.setup();
    render(<TestForm />);
    await user.click(screen.getByText("Submit"));
    await screen.findByText("Username must be at least 3 characters");
    expect(screen.getByText("Username")).toHaveClass("text-destructive");
  });

  it("clears the FormMessage and calls onSubmit once input becomes valid", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TestForm onSubmit={onSubmit} />);
    await user.click(screen.getByText("Submit"));
    await screen.findByText("Username must be at least 3 characters");

    await user.type(screen.getByLabelText("Username"), "alice");
    await user.click(screen.getByText("Submit"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ username: "alice" }),
      expect.anything(),
    );
    expect(screen.queryByText("Username must be at least 3 characters")).not.toBeInTheDocument();
  });

  it("useFormField throws when used outside FormField/FormItem", () => {
    function Bad() {
      const form = useForm();
      return (
        <Form {...form}>
          <FormLabel>orphan</FormLabel>
        </Form>
      );
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow();
    spy.mockRestore();
  });
});
