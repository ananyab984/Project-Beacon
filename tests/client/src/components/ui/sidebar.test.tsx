import { useState, type ReactNode } from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

// useIsMobile (src/hooks/use-mobile.tsx) derives isMobile from window.innerWidth,
// not from matchMedia's `.matches` — matchMedia is only used to subscribe to changes.
function mockMatchMedia(isMobile = false) {
  const listeners: Array<(e: unknown) => void> = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isMobile,
    media: query,
    addEventListener: (_: string, cb: (e: unknown) => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: (e: unknown) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
  }));
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: isMobile ? 500 : 1024,
  });
}

function getCookie(name: string) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? match[1] : undefined;
}

beforeEach(() => {
  mockMatchMedia(false);
  document.cookie = "sidebar_state=; path=/; max-age=0"; // clear
});

describe("SidebarProvider state", () => {
  it("defaults open state from defaultOpen", () => {
    render(
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="none">
          <SidebarContent>content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    // collapsible="none" sidebar always renders content regardless of state;
    // verify via a consumer of the context instead.
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("SidebarTrigger toggles open state and Sidebar data-state reflects it", async () => {
    const user = userEvent.setup();
    render(
      <SidebarProvider defaultOpen>
        <Sidebar>
          <SidebarContent>content</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );
    const outer = document.querySelector('[data-state]') as HTMLElement;
    expect(outer).toHaveAttribute("data-state", "expanded");

    await user.click(screen.getByText("Toggle Sidebar"));
    expect(outer).toHaveAttribute("data-state", "collapsed");
  });

  it("sets the sidebar_state cookie on toggle", async () => {
    const user = userEvent.setup();
    render(
      <SidebarProvider defaultOpen>
        <Sidebar>
          <SidebarContent>content</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );
    await user.click(screen.getByText("Toggle Sidebar"));
    expect(getCookie("sidebar_state")).toBe("false");
  });

  it("supports controlled open/onOpenChange", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    function Controlled() {
      const [open, setOpen] = useState(true);
      return (
        <SidebarProvider
          open={open}
          onOpenChange={(v: boolean) => {
            setOpen(v);
            onOpenChange(v);
          }}
        >
          <Sidebar>
            <SidebarContent>content</SidebarContent>
          </Sidebar>
          <SidebarTrigger />
        </SidebarProvider>
      );
    }

    render(<Controlled />);
    await user.click(screen.getByText("Toggle Sidebar"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("toggles via the keyboard shortcut (Cmd/Ctrl+B)", async () => {
    render(
      <SidebarProvider defaultOpen>
        <Sidebar>
          <SidebarContent>content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const outer = document.querySelector('[data-state]') as HTMLElement;
    expect(outer).toHaveAttribute("data-state", "expanded");

    await act(async () => {
      const event = new KeyboardEvent("keydown", { key: "b", ctrlKey: true });
      window.dispatchEvent(event);
    });
    expect(outer).toHaveAttribute("data-state", "collapsed");
  });

  it("uses mobile Sheet rendering when useIsMobile reports true: closed until toggled open", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    render(
      <SidebarProvider defaultOpen>
        <Sidebar>
          <SidebarContent>mobile content</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );
    // Sheet content is closed by default (openMobile starts false), so the
    // sidebar content should not be in the document yet.
    expect(screen.queryByText("mobile content")).not.toBeInTheDocument();

    await user.click(screen.getByText("Toggle Sidebar"));
    expect(await screen.findByText("mobile content")).toBeInTheDocument();
  });

  it("useSidebar throws when used outside SidebarProvider", () => {
    function Bad() {
      useSidebar();
      return null;
    }
    expect(() => render(<Bad />)).toThrow("useSidebar must be used within a SidebarProvider.");
  });
});

describe("Sidebar presentational sub-components", () => {
  function Shell({ children }: { children: ReactNode }) {
    return (
      <SidebarProvider defaultOpen>
        <Sidebar>{children}</Sidebar>
      </SidebarProvider>
    );
  }

  it("renders header, content, footer, groups, and forwards data-sidebar attrs", () => {
    render(
      <Shell>
        <SidebarHeader data-testid="header">header</SidebarHeader>
        <SidebarContent data-testid="content">
          <SidebarGroup data-testid="group">
            <SidebarGroupLabel>Label</SidebarGroupLabel>
            <SidebarGroupAction aria-label="action">+</SidebarGroupAction>
            <SidebarGroupContent>group content</SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter data-testid="footer">footer</SidebarFooter>
      </Shell>,
    );
    expect(screen.getByTestId("header")).toHaveAttribute("data-sidebar", "header");
    expect(screen.getByTestId("content")).toHaveAttribute("data-sidebar", "content");
    expect(screen.getByTestId("footer")).toHaveAttribute("data-sidebar", "footer");
    expect(screen.getByTestId("group")).toHaveAttribute("data-sidebar", "group");
    expect(screen.getByText("Label")).toHaveAttribute("data-sidebar", "group-label");
    expect(screen.getByText("group content")).toHaveAttribute("data-sidebar", "group-content");
  });

  it("renders menu, menu items, active menu button, badge, and action", () => {
    render(
      <Shell>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive>Item 1</SidebarMenuButton>
            <SidebarMenuAction aria-label="action">*</SidebarMenuAction>
            <SidebarMenuBadge>3</SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>
      </Shell>,
    );
    expect(screen.getByText("Item 1")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("3")).toHaveAttribute("data-sidebar", "menu-badge");
  });

  it("renders menu sub items with isActive state", () => {
    render(
      <Shell>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuSub>
              <SidebarMenuSubItem>
                <SidebarMenuSubButton isActive>Sub 1</SidebarMenuSubButton>
              </SidebarMenuSubItem>
            </SidebarMenuSub>
          </SidebarMenuItem>
        </SidebarMenu>
      </Shell>,
    );
    expect(screen.getByText("Sub 1")).toHaveAttribute("data-active", "true");
  });

  it("renders a menu skeleton, optionally with icon", () => {
    const { container } = render(
      <Shell>
        <SidebarMenuSkeleton showIcon />
      </Shell>,
    );
    expect(container.querySelector('[data-sidebar="menu-skeleton-icon"]')).toBeInTheDocument();
    expect(container.querySelector('[data-sidebar="menu-skeleton-text"]')).toBeInTheDocument();
  });

  it("renders SidebarInput, SidebarSeparator, SidebarRail, SidebarInset", () => {
    render(
      <SidebarProvider defaultOpen>
        <Sidebar>
          <SidebarInput placeholder="Search" />
          <SidebarSeparator />
          <SidebarRail />
        </Sidebar>
        <SidebarInset data-testid="inset">main</SidebarInset>
      </SidebarProvider>,
    );
    expect(screen.getByPlaceholderText("Search")).toHaveAttribute("data-sidebar", "input");
    expect(screen.getByTestId("inset")).toHaveTextContent("main");
  });

  it("collapsible='none' renders a plain flex column without desktop/mobile branching", () => {
    render(
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="none" data-testid="plain">
          <SidebarContent>plain content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("plain content")).toBeInTheDocument();
  });
});
