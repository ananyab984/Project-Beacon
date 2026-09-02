import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/neon-auth", () => ({
  authClient: {
    getSession: vi.fn(),
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    emailOtp: { sendVerificationOtp: vi.fn(), verifyEmail: vi.fn() },
    changePassword: vi.fn(),
  },
  getNeonToken: vi.fn(),
  getNeonTokenResult: vi.fn(),
}));

import { authClient, getNeonToken, getNeonTokenResult } from "@/lib/neon-auth";
import { AuthProvider, useAuth, roleHome } from "@/lib/auth";

const mockUser = { id: "u1", email: "jane@example.com", name: "Jane", role: "recruiter" as const, emailVerified: true };

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// Small consumer component exposing auth state via data attributes / handlers
// so tests can drive it through the DOM rather than reaching into internals.
function Consumer({ onReady }: { onReady?: (ctx: ReturnType<typeof useAuth>) => void }) {
  const ctx = useAuth();
  onReady?.(ctx);
  return (
    <div>
      <div data-testid="hydrating">{String(ctx.isHydrating)}</div>
      <div data-testid="user">{ctx.user ? ctx.user.email : "none"}</div>
      <div data-testid="needs-role-setup">{String(ctx.needsRoleSetup)}</div>
    </div>
  );
}

function renderAuth(onReady?: (ctx: ReturnType<typeof useAuth>) => void) {
  return render(
    <AuthProvider>
      <Consumer onReady={onReady} />
    </AuthProvider>,
    { wrapper }
  );
}

describe("auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    vi.mocked(authClient.getSession).mockResolvedValue({ data: null } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("useAuth", () => {
    it("throws when used outside AuthProvider", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      function Bare() {
        useAuth();
        return null;
      }
      expect(() => render(<Bare />)).toThrow("useAuth must be used within AuthProvider");
      spy.mockRestore();
    });
  });

  describe("roleHome", () => {
    it("maps owner to /owner", () => expect(roleHome("owner")).toBe("/owner"));
    it("maps recruiter to /recruiter", () => expect(roleHome("recruiter")).toBe("/recruiter"));
    it("maps contractor to /contractor", () => expect(roleHome("contractor")).toBe("/contractor"));
    it("defaults unknown roles to /contractor", () => expect(roleHome("bogus")).toBe("/contractor"));
    it("is case-insensitive", () => expect(roleHome("OWNER")).toBe("/owner"));
    it("handles empty input", () => expect(roleHome("")).toBe("/contractor"));
  });

  describe("session hydration", () => {
    it("starts hydrating true, then flips to false with no session", async () => {
      renderAuth();
      expect(screen.getByTestId("hydrating").textContent).toBe("true");
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      expect(screen.getByTestId("user").textContent).toBe("none");
    });

    it("resolves an existing session into a user profile", async () => {
      vi.mocked(authClient.getSession).mockResolvedValue({ data: { user: { email: mockUser.email } } } as any);
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: "tok" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: mockUser }),
      }));

      renderAuth();
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      expect(screen.getByTestId("user").textContent).toBe(mockUser.email);
      expect(screen.getByTestId("needs-role-setup").textContent).toBe("false");
    });

    it("sets needsRoleSetup when session exists but profile resolves to no_profile with no pending role", async () => {
      vi.mocked(authClient.getSession).mockResolvedValue({ data: { user: { email: "new@example.com" } } } as any);
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: "tok" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "NO_PROFILE" }),
      }));

      renderAuth();
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      expect(screen.getByTestId("needs-role-setup").textContent).toBe("true");
      expect(screen.getByTestId("user").textContent).toBe("none");
    });

    it("treats a non-404 failed /me response as an error (not no_profile)", async () => {
      vi.mocked(authClient.getSession).mockResolvedValue({ data: { user: { email: "x@example.com" } } } as any);
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: "tok" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false, status: 500, json: async () => ({ message: "boom" }),
      }));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      renderAuth();
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      expect(screen.getByTestId("user").textContent).toBe("none");
      expect(screen.getByTestId("needs-role-setup").textContent).toBe("false");
      errSpy.mockRestore();
    });

    it("auto-links a pending role from sessionStorage when the profile is missing", async () => {
      vi.mocked(authClient.getSession).mockResolvedValue({ data: { user: { email: "new@example.com" } } } as any);
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: "tok" });
      window.sessionStorage.setItem("g3.pendingRole:new@example.com", "owner");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: "NO_PROFILE" }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user: mockUser }) });
      vi.stubGlobal("fetch", fetchMock);

      renderAuth();
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      expect(screen.getByTestId("user").textContent).toBe(mockUser.email);
      expect(window.sessionStorage.getItem("g3.pendingRole:new@example.com")).toBeNull();
    });

    it("does not set needsRoleSetup when auto-linking the pending role fails (surfaces as error, not no_profile)", async () => {
      vi.mocked(authClient.getSession).mockResolvedValue({ data: { user: { email: "new@example.com" } } } as any);
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: "tok" });
      window.sessionStorage.setItem("g3.pendingRole:new@example.com", "owner");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: "NO_PROFILE" }) })
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: "link failed" }) });
      vi.stubGlobal("fetch", fetchMock);

      renderAuth();
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      expect(screen.getByTestId("user").textContent).toBe("none");
      expect(screen.getByTestId("needs-role-setup").textContent).toBe("false");
    });

    it("does not set user when token resolution fails during hydration", async () => {
      vi.mocked(authClient.getSession).mockResolvedValue({ data: { user: { email: "x@example.com" } } } as any);
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: null, errorDetail: "cold start" });

      renderAuth();
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      expect(screen.getByTestId("user").textContent).toBe("none");
      expect(screen.getByTestId("needs-role-setup").textContent).toBe("false");
    });
  });

  describe("signIn", () => {
    it("resolves with the user and clears the query cache on success", async () => {
      vi.mocked(authClient.signIn.email).mockResolvedValue({ error: null } as any);
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: "tok" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ user: mockUser }),
      }));

      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));

      let result: any;
      await act(async () => {
        result = await ctx!.signIn("jane@example.com", "pw");
      });
      expect(result).toEqual(mockUser);
      await waitFor(() => expect(screen.getByTestId("user").textContent).toBe(mockUser.email));
    });

    it("throws with the Better Auth error message/code on invalid credentials", async () => {
      vi.mocked(authClient.signIn.email).mockResolvedValue({
        error: { message: "Invalid credentials", code: "INVALID_CREDENTIALS", status: 401 },
      } as any);

      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));

      await expect(ctx!.signIn("jane@example.com", "wrong")).rejects.toMatchObject({
        message: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
        email: "jane@example.com",
      });
    });

    it("throws NO_PROFILE and sets needsRoleSetup when the account has no linked profile", async () => {
      vi.mocked(authClient.signIn.email).mockResolvedValue({ error: null } as any);
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: "tok" });
      vi.mocked(authClient.getSession).mockResolvedValue({ data: { user: { email: "new@example.com" } } } as any);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false, status: 404, json: async () => ({ error: "NO_PROFILE" }),
      }));

      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));

      await expect(ctx!.signIn("new@example.com", "pw")).rejects.toMatchObject({ code: "NO_PROFILE" });
      await waitFor(() => expect(screen.getByTestId("needs-role-setup").textContent).toBe("true"));
    });

    it("throws PROFILE_CHECK_FAILED when the profile check errors out", async () => {
      vi.mocked(authClient.signIn.email).mockResolvedValue({ error: null } as any);
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: null, errorDetail: "network down" });

      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));

      await expect(ctx!.signIn("jane@example.com", "pw")).rejects.toMatchObject({ code: "PROFILE_CHECK_FAILED" });
    });

    it("times out with SIGN_IN_TIMEOUT after SIGN_IN_TIMEOUT_MS when Neon Auth hangs", async () => {
      vi.useFakeTimers();
      vi.mocked(authClient.signIn.email).mockReturnValue(new Promise(() => {}) as any);

      let ctx: ReturnType<typeof useAuth> | undefined;
      await act(async () => {
        renderAuth((c) => (ctx = c));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const pending = ctx!.signIn("jane@example.com", "pw");
      const assertion = expect(pending).rejects.toMatchObject({ code: "SIGN_IN_TIMEOUT" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(25_000);
      });
      await assertion;
    });
  });

  describe("signUp", () => {
    it("stashes the pending role in sessionStorage on success", async () => {
      vi.mocked(authClient.signUp.email).mockResolvedValue({ error: null } as any);

      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));

      await act(async () => {
        await ctx!.signUp({ name: "Jane", email: "Jane@Example.com", password: "pw", role: "recruiter" });
      });
      expect(window.sessionStorage.getItem("g3.pendingRole:jane@example.com")).toBe("recruiter");
    });

    it("throws on sign-up error and does not stash a pending role", async () => {
      vi.mocked(authClient.signUp.email).mockResolvedValue({
        error: { message: "Email taken", code: "EMAIL_EXISTS", status: 409 },
      } as any);

      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));

      await expect(
        ctx!.signUp({ name: "Jane", email: "jane@example.com", password: "pw", role: "recruiter" })
      ).rejects.toMatchObject({ message: "Email taken", code: "EMAIL_EXISTS" });
      expect(window.sessionStorage.getItem("g3.pendingRole:jane@example.com")).toBeNull();
    });
  });

  describe("signOut", () => {
    it("clears user state after calling authClient.signOut", async () => {
      vi.mocked(authClient.signIn.email).mockResolvedValue({ error: null } as any);
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: "tok" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ user: mockUser }),
      }));
      vi.mocked(authClient.signOut).mockResolvedValue(undefined as any);

      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await act(async () => {
        await ctx!.signIn("jane@example.com", "pw");
      });
      await waitFor(() => expect(screen.getByTestId("user").textContent).toBe(mockUser.email));

      await act(async () => {
        await ctx!.signOut();
      });
      expect(authClient.signOut).toHaveBeenCalled();
      expect(screen.getByTestId("user").textContent).toBe("none");
      expect(screen.getByTestId("needs-role-setup").textContent).toBe("false");
    });
  });

  describe("password reset / verification / profile", () => {
    it("requestPasswordReset throws on error", async () => {
      vi.mocked(authClient.requestPasswordReset).mockResolvedValue({ error: { message: "no such account" } } as any);
      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await expect(ctx!.requestPasswordReset("x@example.com")).rejects.toThrow("no such account");
    });

    it("requestPasswordReset resolves and passes redirectTo", async () => {
      vi.mocked(authClient.requestPasswordReset).mockResolvedValue({ error: null } as any);
      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await ctx!.requestPasswordReset("x@example.com");
      expect(authClient.requestPasswordReset).toHaveBeenCalledWith({
        email: "x@example.com",
        redirectTo: `${window.location.origin}/reset-password`,
      });
    });

    it("resetPassword throws on error", async () => {
      vi.mocked(authClient.resetPassword).mockResolvedValue({ error: { message: "expired token" } } as any);
      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await expect(ctx!.resetPassword("tok", "newpw")).rejects.toThrow("expired token");
    });

    it("sendVerificationOtp throws on error", async () => {
      vi.mocked(authClient.emailOtp.sendVerificationOtp).mockResolvedValue({ error: { message: "rate limited" } } as any);
      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await expect(ctx!.sendVerificationOtp("x@example.com")).rejects.toThrow("rate limited");
    });

    it("verifyEmailOtp throws on invalid code", async () => {
      vi.mocked(authClient.emailOtp.verifyEmail).mockResolvedValue({ error: { message: "bad code" } } as any);
      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await expect(ctx!.verifyEmailOtp("x@example.com", "000000")).rejects.toThrow("bad code");
    });

    it("verifyEmailOtp links a pending role via postProfile when present", async () => {
      vi.mocked(authClient.emailOtp.verifyEmail).mockResolvedValue({ error: null } as any);
      vi.mocked(getNeonToken).mockResolvedValue("tok");
      window.sessionStorage.setItem("g3.pendingRole:x@example.com", "owner");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ user: mockUser }),
      }));

      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await act(async () => {
        await ctx!.verifyEmailOtp("x@example.com", "123456");
      });
      expect(window.sessionStorage.getItem("g3.pendingRole:x@example.com")).toBeNull();
    });

    it("verifyEmailOtp does not throw when postProfile fails after verification (retried at sign-in)", async () => {
      vi.mocked(authClient.emailOtp.verifyEmail).mockResolvedValue({ error: null } as any);
      vi.mocked(getNeonToken).mockResolvedValue("tok");
      window.sessionStorage.setItem("g3.pendingRole:x@example.com", "owner");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false, status: 500, json: async () => ({ message: "server error" }),
      }));

      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await expect(ctx!.verifyEmailOtp("x@example.com", "123456")).resolves.toBeUndefined();
      expect(window.sessionStorage.getItem("g3.pendingRole:x@example.com")).toBe("owner");
    });

    it("verifyEmailOtp logs and continues when no token is available to finish setup", async () => {
      vi.mocked(authClient.emailOtp.verifyEmail).mockResolvedValue({ error: null } as any);
      vi.mocked(getNeonToken).mockResolvedValue(null);
      window.sessionStorage.setItem("g3.pendingRole:x@example.com", "owner");

      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await expect(ctx!.verifyEmailOtp("x@example.com", "123456")).resolves.toBeUndefined();
    });

    it("completeProfile sets the user and clears needsRoleSetup", async () => {
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: "tok" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ user: mockUser }),
      }));

      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));

      let result: any;
      await act(async () => {
        result = await ctx!.completeProfile("recruiter");
      });
      expect(result).toEqual(mockUser);
      await waitFor(() => expect(screen.getByTestId("user").textContent).toBe(mockUser.email));
      expect(screen.getByTestId("needs-role-setup").textContent).toBe("false");
    });

    it("completeProfile throws when no session token is available", async () => {
      vi.mocked(getNeonTokenResult).mockResolvedValue({ token: null, errorDetail: "expired" });
      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await expect(ctx!.completeProfile("recruiter")).rejects.toThrow(/expired/);
    });

    it("changePassword throws on error", async () => {
      vi.mocked(authClient.changePassword).mockResolvedValue({ error: { message: "wrong current password" } } as any);
      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await expect(ctx!.changePassword("wrong", "new")).rejects.toThrow("wrong current password");
    });

    it("changePassword resolves on success", async () => {
      vi.mocked(authClient.changePassword).mockResolvedValue({ error: null } as any);
      let ctx: ReturnType<typeof useAuth> | undefined;
      renderAuth((c) => (ctx = c));
      await waitFor(() => expect(screen.getByTestId("hydrating").textContent).toBe("false"));
      await expect(ctx!.changePassword("old", "new")).resolves.toBeUndefined();
    });
  });
});
