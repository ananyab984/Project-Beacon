import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { AccountStatus, UnipileProvider } from "@prisma/client";

vi.mock("axios");

const { getConfig, setConfig } = vi.hoisted(() => {
  let cfg: any = {
    unipileDsn: "api25.unipile.com:15598",
    unipileApiKey: "test-api-key",
    unipileLiveSendsEnabled: true,
    unipileWebhookPathToken: "path-token",
    unipileWebhookSecret: "webhook-secret",
    appBaseUrl: "http://localhost:5001",
    clientUrl: "http://localhost:5173",
  };
  return { getConfig: () => cfg, setConfig: (c: any) => (cfg = c) };
});

vi.mock("@server/config", () => ({
  get config() {
    return getConfig();
  },
}));

vi.mock("@server-root/prisma", () => ({
  prisma: {
    connectedAccount: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    unipileAuthAttempt: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    interactionEvent: { create: vi.fn(), updateMany: vi.fn() },
    conversation: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    conversationMessage: { create: vi.fn(), findFirst: vi.fn() },
    lead: { findUnique: vi.fn() },
    unipileWebhookEvent: { findUnique: vi.fn(), create: vi.fn() },
    accountDegradation: { create: vi.fn() },
    inboundMessage: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "@server-root/prisma";
import { UnipileService, stripQuotedReplyHistory } from "@server/services/unipile.service";

const p: any = prisma;
const mockAxiosPost = axios.post as unknown as ReturnType<typeof vi.fn>;
const mockAxiosGet = axios.get as unknown as ReturnType<typeof vi.fn>;
const mockAxiosDelete = axios.delete as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  setConfig({
    unipileDsn: "api25.unipile.com:15598",
    unipileApiKey: "test-api-key",
    unipileLiveSendsEnabled: true,
    unipileWebhookPathToken: "path-token",
    unipileWebhookSecret: "webhook-secret",
    appBaseUrl: "http://localhost:5001",
    clientUrl: "http://localhost:5173",
  });
  p.interactionEvent.create.mockResolvedValue({ id: "evt-1" });
  p.lead.findUnique.mockResolvedValue({ id: "lead-1", fullName: "Jane Doe", firstName: "Jane" });
  p.conversation.findFirst.mockResolvedValue(null);
  p.conversation.create.mockResolvedValue({ id: "conv-1", unipileChatId: null });
  p.conversationMessage.create.mockResolvedValue({});
  p.connectedAccount.findFirst.mockResolvedValue(null);
  p.unipileAuthAttempt.findFirst.mockResolvedValue(null);
  p.unipileAuthAttempt.delete.mockResolvedValue({});
});

describe("stripQuotedReplyHistory", () => {
  it("cuts a Gmail-style 'On ... wrote:' header and everything after it", () => {
    const text = "Sure, sounds good!\n\nOn Wed, 26 Aug 2026, 4:39 pm Jane <j@x.com> wrote:\n> original message";
    expect(stripQuotedReplyHistory(text)).toBe("Sure, sounds good!");
  });

  it("cuts an Outlook '-----Original Message-----' divider", () => {
    const text = "Thanks, that works.\n-----Original Message-----\nFrom: Bob";
    expect(stripQuotedReplyHistory(text)).toBe("Thanks, that works.");
  });

  it("cuts an Outlook From/Sent/To/Subject header block", () => {
    const text = "New reply text\nFrom: bob@x.com\nSent: Monday\nTo: jane@x.com\nSubject: Re: hello";
    expect(stripQuotedReplyHistory(text)).toBe("New reply text");
  });

  it("returns the trimmed text unchanged when no quote header is present", () => {
    expect(stripQuotedReplyHistory("  Just a plain reply  ")).toBe("Just a plain reply");
  });

  it("falls back to the untouched original when the message is entirely a quoted forward", () => {
    const text = "On Wed, 26 Aug 2026, 4:39 pm Jane <j@x.com> wrote:\n> only quoted content";
    expect(stripQuotedReplyHistory(text)).toBe(text.trim());
  });

  it("picks the earliest matching header when more than one pattern could match", () => {
    const text = "Real reply\n-----Original Message-----\nOn Wed wrote:\nnope";
    expect(stripQuotedReplyHistory(text)).toBe("Real reply");
  });
});

describe("UnipileService.sendEmail", () => {
  it("throws 403 LIVE_SENDS_DISABLED when live sends are off", async () => {
    setConfig({ ...getConfig(), unipileLiveSendsEnabled: false });
    await expect(UnipileService.sendEmail("u1", "lead-1", "a@b.com", "Hi", "body")).rejects.toMatchObject({
      statusCode: 403,
      code: "LIVE_SENDS_DISABLED",
    });
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it("throws 409 ACCOUNT_NOT_CONNECTED when the user has no connected email account", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(null);
    await expect(UnipileService.sendEmail("u1", "lead-1", "a@b.com", "Hi", "body")).rejects.toMatchObject({
      statusCode: 409,
      code: "ACCOUNT_NOT_CONNECTED",
    });
  });

  it("prefers the preferredAccountId lookup over the generic email-provider lookup", async () => {
    p.connectedAccount.findFirst.mockResolvedValueOnce({ unipileAccountId: "acc-preferred" });
    mockAxiosPost.mockResolvedValue({ data: { id: "mail-1" } });
    await UnipileService.sendEmail("u1", "lead-1", "a@b.com", "Hi", "body", "acc-preferred");
    expect(p.connectedAccount.findFirst).toHaveBeenCalledTimes(1);
    expect(p.connectedAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ unipileAccountId: "acc-preferred" }) })
    );
  });

  it("wraps the plaintext body into paragraph-tagged HTML and sets tracking options", async () => {
    p.connectedAccount.findFirst.mockResolvedValue({ unipileAccountId: "acc-1" });
    mockAxiosPost.mockResolvedValue({ data: { id: "mail-1" } });
    await UnipileService.sendEmail("u1", "lead-1", "a@b.com", "Hi", "Para one\n\nPara two");
    const [, payload] = mockAxiosPost.mock.calls[0];
    expect(payload.body).toBe('<p style="margin:0 0 1em 0;">Para one</p><p style="margin:0 0 1em 0;">Para two</p>');
    expect(payload.tracking_options).toEqual({ opens: true, links: true, label: "global3-outreach" });
    expect(payload.to).toEqual([{ identifier: "a@b.com", display_name: "" }]);
  });

  it("includes reply_to only when replyToMessageId is given", async () => {
    p.connectedAccount.findFirst.mockResolvedValue({ unipileAccountId: "acc-1" });
    mockAxiosPost.mockResolvedValue({ data: { id: "mail-1" } });

    await UnipileService.sendEmail("u1", "lead-1", "a@b.com", "Hi", "body");
    expect(mockAxiosPost.mock.calls[0][1]).not.toHaveProperty("reply_to");

    await UnipileService.sendEmail("u1", "lead-1", "a@b.com", "Hi", "body", undefined, "msg-123");
    expect(mockAxiosPost.mock.calls[1][1]).toMatchObject({ reply_to: "msg-123" });
  });

  it("records an OUTBOUND InteractionEvent and syncs the Conversation on success", async () => {
    p.connectedAccount.findFirst.mockResolvedValue({ unipileAccountId: "acc-1" });
    mockAxiosPost.mockResolvedValue({ data: { id: "mail-1", thread_id: "thread-1" } });

    const result = await UnipileService.sendEmail("u1", "lead-1", "a@b.com", "Hi", "body");

    expect(p.interactionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ direction: "OUTBOUND", channel: "EMAIL", externalMessageId: "mail-1" }) })
    );
    expect(p.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: "EMAIL", unipileChatId: "thread-1" }) })
    );
    expect(result).toMatchObject({ success: true, externalMessageId: "mail-1" });
  });

  it("retries on a transient failure and succeeds once a later attempt works", async () => {
    p.connectedAccount.findFirst.mockResolvedValue({ unipileAccountId: "acc-1" });
    mockAxiosPost.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce({ data: { id: "mail-1" } });

    vi.useFakeTimers();
    const promise = UnipileService.sendEmail("u1", "lead-1", "a@b.com", "Hi", "body");
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.externalMessageId).toBe("mail-1");
    expect(mockAxiosPost).toHaveBeenCalledTimes(2);
  });

  it("exhausts all retries and throws when every attempt fails", async () => {
    p.connectedAccount.findFirst.mockResolvedValue({ unipileAccountId: "acc-1" });
    mockAxiosPost.mockRejectedValue({ response: { status: 500 } });

    vi.useFakeTimers();
    const promise = UnipileService.sendEmail("u1", "lead-1", "a@b.com", "Hi", "body").catch((e) => e);
    for (const wait of [1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(wait);
    }
    const err = await promise;
    vi.useRealTimers();

    expect(err).toBeTruthy();
    expect(mockAxiosPost).toHaveBeenCalledTimes(5);
    expect(p.interactionEvent.create).not.toHaveBeenCalled();
  });
});

describe("UnipileService.sendLinkedInMessage", () => {
  function connectedAcc() {
    return { unipileAccountId: "li-acc-1", userId: "u1" };
  }

  it("throws 403 LIVE_SENDS_DISABLED when live sends are off", async () => {
    setConfig({ ...getConfig(), unipileLiveSendsEnabled: false });
    await expect(UnipileService.sendLinkedInMessage("u1", "lead-1", "id123", "hi")).rejects.toMatchObject({
      statusCode: 403,
      code: "LIVE_SENDS_DISABLED",
    });
  });

  it("throws 409 ACCOUNT_NOT_CONNECTED when no LinkedIn account is connected", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(null);
    await expect(UnipileService.sendLinkedInMessage("u1", "lead-1", "id123", "hi")).rejects.toMatchObject({
      statusCode: 409,
      code: "ACCOUNT_NOT_CONNECTED",
    });
  });

  it("extracts the profile identifier out of a full linkedin.com/in/ URL", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(connectedAcc());
    mockAxiosGet.mockResolvedValue({ data: { network_distance: "FIRST_DEGREE" } });
    mockAxiosPost.mockResolvedValue({ data: { id: "chat-1" } });

    await UnipileService.sendLinkedInMessage("u1", "lead-1", "https://linkedin.com/in/jane-doe?x=1", "hi");

    expect(mockAxiosGet.mock.calls[0][0]).toContain("/users/jane-doe?");
  });

  it("1st-degree connections skip the invite step and go straight to a direct message", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(connectedAcc());
    mockAxiosGet.mockResolvedValue({ data: { network_distance: "FIRST_DEGREE", provider_id: "prov-1" } });
    mockAxiosPost.mockResolvedValue({ data: { id: "chat-1" } });

    const result = await UnipileService.sendLinkedInMessage("u1", "lead-1", "prov-1", "hi");

    expect(result.mode).toBe("direct_message");
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockAxiosPost.mock.calls[0][0]).toContain("/chats");
  });

  it("2nd/3rd-degree connections send a connection invite and never fall through to a DM", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(connectedAcc());
    mockAxiosGet.mockResolvedValue({ data: { network_distance: "SECOND_DEGREE", provider_id: "prov-1" } });
    mockAxiosPost.mockResolvedValue({ data: { invitation_id: "inv-1" } });

    const result = await UnipileService.sendLinkedInMessage("u1", "lead-1", "prov-1", "hi");

    expect(result.mode).toBe("connection_invite");
    expect(result.externalMessageId).toBe("inv-1");
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockAxiosPost.mock.calls[0][0]).toContain("/users/invite");
  });

  it("does not trust an invite response's bare `.id` as the chat id (different id space)", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(connectedAcc());
    mockAxiosGet.mockResolvedValue({ data: { network_distance: "SECOND_DEGREE", provider_id: "prov-1" } });
    mockAxiosPost.mockResolvedValue({ data: { id: "7498301028656902144" } });

    await UnipileService.sendLinkedInMessage("u1", "lead-1", "prov-1", "hi");

    expect(p.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ unipileChatId: undefined }) })
    );
  });

  it("falls back to a direct message when the 2nd/3rd-degree invite attempt fails", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(connectedAcc());
    mockAxiosGet.mockResolvedValue({ data: { network_distance: "SECOND_DEGREE", provider_id: "prov-1" } });
    mockAxiosPost.mockRejectedValueOnce(new Error("invite failed")).mockResolvedValueOnce({ data: { id: "chat-1" } });

    const result = await UnipileService.sendLinkedInMessage("u1", "lead-1", "prov-1", "hi");

    expect(result.mode).toBe("direct_message");
    expect(mockAxiosPost).toHaveBeenCalledTimes(2);
  });

  it("falls back to a connection-invite-with-note when a 1st-degree DM attempt fails", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(connectedAcc());
    mockAxiosGet.mockResolvedValue({ data: { network_distance: "FIRST_DEGREE", provider_id: "prov-1" } });
    mockAxiosPost.mockRejectedValueOnce(new Error("dm failed")).mockResolvedValueOnce({ data: { invitation_id: "inv-1" } });

    const result = await UnipileService.sendLinkedInMessage("u1", "lead-1", "prov-1", "hi");

    expect(result.mode).toBe("connection_invite_fallback");
    expect(mockAxiosPost).toHaveBeenCalledTimes(2);
  });

  it("throws when both the DM attempt and the invite fallback fail", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(connectedAcc());
    mockAxiosGet.mockResolvedValue({ data: { network_distance: "FIRST_DEGREE", provider_id: "prov-1" } });
    mockAxiosPost.mockRejectedValue(new Error("nope"));

    await expect(UnipileService.sendLinkedInMessage("u1", "lead-1", "prov-1", "hi")).rejects.toThrow(
      /Failed to send LinkedIn DM or Invite/
    );
    expect(p.interactionEvent.create).not.toHaveBeenCalled();
  });

  it("swallows a failed profile lookup and proceeds directly with the raw identifier", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(connectedAcc());
    mockAxiosGet.mockRejectedValue({ response: { status: 500 } });
    mockAxiosPost.mockResolvedValue({ data: { id: "chat-1" } });

    vi.useFakeTimers();
    const promise = UnipileService.sendLinkedInMessage("u1", "lead-1", "prov-1", "hi");
    for (const wait of [1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(wait);
    }
    const result = await promise;
    vi.useRealTimers();

    expect(result.mode).toBe("direct_message");
    expect(mockAxiosGet).toHaveBeenCalledTimes(5);
  });
});

describe("UnipileService.mintHostedAuthLink", () => {
  it("throws 400 for an invalid provider", async () => {
    await expect(UnipileService.mintHostedAuthLink("u1", "carrier_pigeon")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("groups GOOGLE/OUTLOOK/MAIL under EMAIL and disables bypass_success_screen", async () => {
    p.unipileAuthAttempt.create.mockResolvedValue({});
    mockAxiosPost.mockResolvedValue({ data: { url: "https://connect.example.com" } });

    await UnipileService.mintHostedAuthLink("u1", "email");

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.providers).toEqual(["MAIL", "GOOGLE", "OUTLOOK"]);
    expect(payload.bypass_success_screen).toBe(false);
  });

  it("throws 409 ALREADY_CONNECTED in create mode when an OK connection already exists", async () => {
    p.connectedAccount.findFirst.mockResolvedValue({ accountName: "jane@x.com" });
    await expect(UnipileService.mintHostedAuthLink("u1", "linkedin", "create")).rejects.toMatchObject({
      statusCode: 409,
      code: "ALREADY_CONNECTED",
    });
  });

  it("throws 409 CONNECTION_PENDING in create mode when an unexpired attempt already exists", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(null);
    p.unipileAuthAttempt.findFirst.mockResolvedValue({ expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
    await expect(UnipileService.mintHostedAuthLink("u1", "linkedin", "create")).rejects.toMatchObject({
      statusCode: 409,
      code: "CONNECTION_PENDING",
    });
  });

  it("skips the ALREADY_CONNECTED/CONNECTION_PENDING checks in reconnect mode", async () => {
    p.unipileAuthAttempt.create.mockResolvedValue({});
    mockAxiosPost.mockResolvedValue({ data: { url: "https://connect.example.com" } });

    await UnipileService.mintHostedAuthLink("u1", "linkedin", "reconnect");

    expect(p.connectedAccount.findFirst).not.toHaveBeenCalled();
    expect(p.unipileAuthAttempt.findFirst).not.toHaveBeenCalled();
  });

  it("creates the auth attempt and returns the hosted url + nonce on the happy path", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(null);
    p.unipileAuthAttempt.findFirst.mockResolvedValue(null);
    p.unipileAuthAttempt.create.mockResolvedValue({});
    mockAxiosPost.mockResolvedValue({ data: { url: "https://connect.example.com" } });

    const result = await UnipileService.mintHostedAuthLink("u1", "linkedin", "create");

    expect(result.url).toBe("https://connect.example.com");
    expect(typeof result.nonce).toBe("string");
    expect(p.unipileAuthAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u1", provider: "LINKEDIN", nonce: result.nonce }) })
    );
  });
});

describe("UnipileService.cancelPendingAuthAttempt", () => {
  it("does nothing for an invalid provider", async () => {
    await UnipileService.cancelPendingAuthAttempt("u1", "not_a_provider");
    expect(p.unipileAuthAttempt.deleteMany).not.toHaveBeenCalled();
  });

  it("does not delete anything if the account already succeeded (already connected)", async () => {
    p.connectedAccount.findFirst.mockResolvedValue({ id: "acc-1" });
    await UnipileService.cancelPendingAuthAttempt("u1", "linkedin");
    expect(p.unipileAuthAttempt.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes the pending attempt(s) when no connection has succeeded yet", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(null);
    await UnipileService.cancelPendingAuthAttempt("u1", "linkedin");
    expect(p.unipileAuthAttempt.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "u1" }) })
    );
  });
});

describe("UnipileService.getUserConnectedAccounts", () => {
  it("never attributes an unclaimed/other-user's account -- only refreshes accounts this user already owns", async () => {
    mockAxiosGet.mockResolvedValue({ data: { items: [{ id: "acc-1", provider: "LINKEDIN", status: "OK" }] } });
    p.connectedAccount.findUnique.mockResolvedValue({ userId: "someone-else" });
    p.connectedAccount.findMany.mockResolvedValue([]);

    await UnipileService.getUserConnectedAccounts("u1");

    expect(p.connectedAccount.upsert).not.toHaveBeenCalled();
    expect(p.connectedAccount.update).not.toHaveBeenCalled();
  });

  it("refreshes status for an account this user already legitimately owns", async () => {
    mockAxiosGet.mockResolvedValue({ data: { items: [{ id: "acc-1", provider: "LINKEDIN", status: "OK", name: "Jane" }] } });
    p.connectedAccount.findUnique.mockResolvedValue({ userId: "u1", unipileAccountId: "acc-1" });
    p.connectedAccount.upsert.mockResolvedValue({});
    p.connectedAccount.findMany.mockResolvedValue([]);

    await UnipileService.getUserConnectedAccounts("u1");

    expect(p.connectedAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ provider: "LINKEDIN", status: AccountStatus.OK }) })
    );
  });

  it("still returns the local DB accounts when the live Unipile sync call fails", async () => {
    mockAxiosGet.mockRejectedValue(new Error("network down"));
    p.connectedAccount.findMany.mockResolvedValue([{ id: "acc-1" }]);

    const result = await UnipileService.getUserConnectedAccounts("u1");

    expect(result).toEqual([{ id: "acc-1" }]);
  });
});

describe("UnipileService.disconnectAccount", () => {
  it("throws 404 when the account doesn't belong to this user", async () => {
    p.connectedAccount.findFirst.mockResolvedValue(null);
    await expect(UnipileService.disconnectAccount("u1", "acc-1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("marks DISCONNECTED in the DB even when the Unipile delete API call fails", async () => {
    p.connectedAccount.findFirst.mockResolvedValue({ id: "acc-1", userId: "u1" });
    mockAxiosDelete.mockRejectedValue(new Error("upstream 500"));
    p.connectedAccount.update.mockResolvedValue({ status: AccountStatus.DISCONNECTED });

    const result = await UnipileService.disconnectAccount("u1", "acc-1");

    expect(p.connectedAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: AccountStatus.DISCONNECTED }) })
    );
    expect(result.status).toBe(AccountStatus.DISCONNECTED);
  });
});

describe("UnipileService.handleWebhookEvent", () => {
  const validToken = "path-token";
  const validSecret = "webhook-secret";

  beforeEach(() => {
    p.unipileWebhookEvent.findUnique.mockResolvedValue(null);
    p.unipileWebhookEvent.create.mockResolvedValue({ id: "evt-1" });
  });

  it("throws 401 for an invalid path token", async () => {
    await expect(UnipileService.handleWebhookEvent("wrong-token", validSecret, {})).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 401 for an invalid secret header", async () => {
    await expect(UnipileService.handleWebhookEvent(validToken, "wrong-secret", {})).rejects.toMatchObject({ statusCode: 401 });
  });

  it("short-circuits as already_processed for a duplicate (deduped) payload", async () => {
    p.unipileWebhookEvent.findUnique.mockResolvedValue({ id: "existing-evt" });
    const result = await UnipileService.handleWebhookEvent(validToken, validSecret, { event: "x" });
    expect(result).toEqual({ status: "already_processed", id: "existing-evt" });
    expect(p.unipileWebhookEvent.create).not.toHaveBeenCalled();
  });

  describe("account status handling", () => {
    it("attributes a brand-new account via the nonce embedded in body.name", async () => {
      p.connectedAccount.findUnique.mockResolvedValue(null);
      p.unipileAuthAttempt.findUnique.mockResolvedValue({ id: "attempt-1", userId: "u1", provider: "LINKEDIN" });
      p.connectedAccount.findUnique.mockResolvedValue(null);

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        AccountStatus: { account_id: "acc-1", message: "CREATION_SUCCESS", account_type: "LINKEDIN" },
        name: "g3_u1_abc123",
      });

      expect(p.connectedAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ userId: "u1", unipileAccountId: "acc-1" }) })
      );
      expect(p.unipileAuthAttempt.delete).toHaveBeenCalledWith({ where: { id: "attempt-1" } });
    });

    it("falls back to the exactly-one-unexpired-candidate match when no nonce resolves", async () => {
      p.connectedAccount.findUnique.mockResolvedValue(null);
      p.unipileAuthAttempt.findUnique.mockResolvedValue(null);
      p.unipileAuthAttempt.findMany.mockResolvedValue([{ id: "attempt-1", userId: "u2", provider: "EMAIL" }]);

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        AccountStatus: { account_id: "acc-2", message: "SYNC_SUCCESS", account_type: "GOOGLE" },
      });

      expect(p.connectedAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ userId: "u2", unipileAccountId: "acc-2" }) })
      );
    });

    it("refuses to guess and does not attribute anything when more than one candidate attempt is ambiguous", async () => {
      p.connectedAccount.findUnique.mockResolvedValue(null);
      p.unipileAuthAttempt.findUnique.mockResolvedValue(null);
      p.unipileAuthAttempt.findMany.mockResolvedValue([
        { id: "attempt-1", userId: "u2", provider: "EMAIL" },
        { id: "attempt-2", userId: "u3", provider: "EMAIL" },
      ]);

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        AccountStatus: { account_id: "acc-2", message: "SYNC_SUCCESS", account_type: "GOOGLE" },
      });

      expect(p.connectedAccount.upsert).not.toHaveBeenCalled();
      expect(p.connectedAccount.update).not.toHaveBeenCalled();
    });

    it("records an AccountDegradation and updates status when an existing account's status changes", async () => {
      p.connectedAccount.findUnique.mockResolvedValue({ id: "conn-1", status: AccountStatus.OK });

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        AccountStatus: { account_id: "acc-1", message: "CREDENTIALS" },
      });

      expect(p.accountDegradation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ fromStatus: AccountStatus.OK, toStatus: AccountStatus.RECONNECTION_NEEDED }) })
      );
      expect(p.connectedAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "conn-1" }, data: expect.objectContaining({ status: AccountStatus.RECONNECTION_NEEDED }) })
      );
    });

    it("does nothing when the existing account's status hasn't actually changed", async () => {
      p.connectedAccount.findUnique.mockResolvedValue({ id: "conn-1", status: AccountStatus.OK });

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        AccountStatus: { account_id: "acc-1", message: "SYNC_SUCCESS" },
      });

      expect(p.accountDegradation.create).not.toHaveBeenCalled();
      expect(p.connectedAccount.update).not.toHaveBeenCalled();
    });
  });

  describe("email tracking events", () => {
    it("marks an InteractionEvent 'opened' on a mail_opened event", async () => {
      await UnipileService.handleWebhookEvent(validToken, validSecret, { event: "mail_opened", tracking_id: "track-1" });
      expect(p.interactionEvent.updateMany).toHaveBeenCalledWith({
        where: { externalMessageId: "track-1" },
        data: { deliveryStatus: "opened" },
      });
    });

    it("marks an InteractionEvent 'clicked' on a mail_link_clicked event", async () => {
      await UnipileService.handleWebhookEvent(validToken, validSecret, { event: "mail_link_clicked", tracking_id: "track-1" });
      expect(p.interactionEvent.updateMany).toHaveBeenCalledWith({
        where: { externalMessageId: "track-1" },
        data: { deliveryStatus: "clicked" },
      });
    });
  });

  describe("inbound message events", () => {
    it("is idempotent: an already-stored inbound message id short-circuits without further writes", async () => {
      p.inboundMessage.findUnique.mockResolvedValue({ id: "existing-inbound" });

      const result = await UnipileService.handleWebhookEvent(validToken, validSecret, {
        event: "message_received",
        account_id: "acc-1",
        message_id: "msg-1",
        text: "hello",
      });

      expect(result).toEqual({ status: "already_processed", inboundMessageId: "existing-inbound", dedupeKey: expect.any(String) });
      expect(p.inboundMessage.create).not.toHaveBeenCalled();
    });

    it("uses email_id (not the raw RFC822 message_id) as the external id for inbound email", async () => {
      p.inboundMessage.findUnique.mockResolvedValue(null);
      p.inboundMessage.create.mockResolvedValue({ id: "inbound-1" });
      p.connectedAccount.findUnique.mockResolvedValue(null);

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        event: "mail_received",
        account_id: "acc-1",
        message_id: "<abc@mail.gmail.com>",
        email_id: "unipile-native-id",
        body_plain: "hi there",
      });

      expect(p.inboundMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ unipileMessageId: "unipile-native-id", channel: "EMAIL" }) })
      );
    });

    it("matches an existing conversation by chat id and records the inbound reply as THEM", async () => {
      p.inboundMessage.findUnique.mockResolvedValue(null);
      p.inboundMessage.create.mockResolvedValue({ id: "inbound-1" });
      p.connectedAccount.findUnique.mockResolvedValue({ id: "conn-1", userId: "u1", accountName: "me@x.com", provider: "EMAIL" });
      p.conversation.findUnique.mockResolvedValue({ id: "conv-1", leadId: "lead-1", unipileChatId: "chat-1" });
      p.inboundMessage.findMany.mockResolvedValue([]);
      p.conversationMessage.findFirst.mockResolvedValue(null);

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        event: "message_received",
        account_id: "acc-1",
        message_id: "msg-1",
        chat_id: "chat-1",
        text: "candidate reply",
        from_attendee: { identifier: "candidate@x.com" },
      });

      expect(p.conversationMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sender: "THEM", text: "candidate reply" }) })
      );
      expect(p.interactionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ direction: "INBOUND", leadId: "lead-1" }) })
      );
      expect(p.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "conv-1" }, data: expect.objectContaining({ unread: true }) })
      );
    });

    it("never re-inserts our own outbound echo as a new message", async () => {
      p.inboundMessage.findUnique.mockResolvedValue(null);
      p.inboundMessage.create.mockResolvedValue({ id: "inbound-1" });
      p.connectedAccount.findUnique.mockResolvedValue({ id: "conn-1", userId: "u1", accountName: "me@x.com", provider: "LINKEDIN" });
      p.conversation.findUnique.mockResolvedValue({ id: "conv-1", leadId: "lead-1", unipileChatId: "chat-1" });
      p.inboundMessage.findMany.mockResolvedValue([]);

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        event: "message_received",
        account_id: "acc-1",
        message_id: "msg-1",
        chat_id: "chat-1",
        text: "my own outbound message",
        is_sender: true,
      });

      expect(p.conversationMessage.create).not.toHaveBeenCalled();
      expect(p.interactionEvent.create).not.toHaveBeenCalled();
    });

    it("backfills a conversation's chat id via self-echo when exactly one outbound-text candidate matches", async () => {
      p.inboundMessage.findUnique.mockResolvedValue(null);
      p.inboundMessage.create.mockResolvedValue({ id: "inbound-1" });
      p.connectedAccount.findUnique.mockResolvedValue({ id: "conn-1", userId: "u1", accountName: "me@x.com", provider: "LINKEDIN" });
      p.conversation.findUnique.mockResolvedValue(null);
      p.conversation.findMany.mockResolvedValue([{ id: "conv-1" }]);
      p.conversation.update.mockResolvedValue({ id: "conv-1", leadId: "lead-1" });
      p.inboundMessage.findMany.mockResolvedValue([]);

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        event: "message_received",
        account_id: "acc-1",
        message_id: "msg-1",
        chat_id: "chat-1",
        text: "cold outreach note",
        is_sender: true,
      });

      expect(p.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "conv-1" }, data: { unipileChatId: "chat-1" } })
      );
    });

    it("refuses to guess when the self-echo backfill has more than one equally exact candidate", async () => {
      p.inboundMessage.findUnique.mockResolvedValue(null);
      p.inboundMessage.create.mockResolvedValue({ id: "inbound-1" });
      p.connectedAccount.findUnique.mockResolvedValue({ id: "conn-1", userId: "u1", accountName: "me@x.com", provider: "LINKEDIN" });
      p.conversation.findUnique.mockResolvedValue(null);
      p.conversation.findMany.mockResolvedValue([{ id: "conv-1" }, { id: "conv-2" }]);
      p.inboundMessage.findMany.mockResolvedValue([]);

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        event: "message_received",
        account_id: "acc-1",
        message_id: "msg-1",
        chat_id: "chat-1",
        text: "identical template",
        is_sender: true,
      });

      expect(p.conversation.update).not.toHaveBeenCalled();
    });

    it("backfills a conversation via the lead's own email address for a genuinely inbound email reply", async () => {
      p.inboundMessage.findUnique.mockResolvedValue(null);
      p.inboundMessage.create.mockResolvedValue({ id: "inbound-1" });
      p.connectedAccount.findUnique.mockResolvedValue({ id: "conn-1", userId: "u1", accountName: "me@x.com", provider: "EMAIL" });
      p.conversation.findUnique.mockResolvedValue(null);
      p.conversation.findMany.mockResolvedValue([{ id: "conv-1" }]);
      p.conversation.update.mockResolvedValue({ id: "conv-1", leadId: "lead-1" });
      p.inboundMessage.findMany.mockResolvedValue([]);

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        event: "mail_received",
        account_id: "acc-1",
        email_id: "email-1",
        chat_id: "thread-1",
        body_plain: "candidate email reply",
        from_attendee: { identifier: "candidate@x.com" },
      });

      expect(p.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lead: { email: { equals: "candidate@x.com", mode: "insensitive" } } }),
        })
      );
      expect(p.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "conv-1" }, data: { unipileChatId: "thread-1" } })
      );
    });

    it("catches up on an earlier InboundMessage for the same thread that arrived before the conversation could be matched", async () => {
      p.inboundMessage.findUnique.mockResolvedValue(null);
      p.inboundMessage.create.mockResolvedValue({ id: "inbound-2" });
      p.connectedAccount.findUnique.mockResolvedValue({ id: "conn-1", userId: "u1", accountName: "me@x.com", provider: "LINKEDIN" });
      p.conversation.findUnique.mockResolvedValue({ id: "conv-1", leadId: "lead-1", unipileChatId: "chat-1" });
      p.inboundMessage.findMany.mockResolvedValue([
        { unipileMessageId: "earlier-msg", sender: "candidate-provider-id", content: "earlier reply text", receivedAt: new Date("2026-01-01") },
      ]);
      p.conversationMessage.findFirst.mockResolvedValue(null);

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        event: "message_received",
        account_id: "acc-1",
        message_id: "msg-2",
        chat_id: "chat-1",
        text: "current reply",
        account_info: { user_id: "me-provider-id" },
        sender: { attendee_provider_id: "candidate-provider-id" },
      });

      expect(p.conversationMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ text: "earlier reply text", externalMessageId: "earlier-msg", sender: "THEM" }) })
      );
    });

    it("skips re-inserting an earlier InboundMessage during catch-up if it was our own echo", async () => {
      p.inboundMessage.findUnique.mockResolvedValue(null);
      p.inboundMessage.create.mockResolvedValue({ id: "inbound-2" });
      p.connectedAccount.findUnique.mockResolvedValue({ id: "conn-1", userId: "u1", accountName: "me@x.com", provider: "LINKEDIN" });
      p.conversation.findUnique.mockResolvedValue({ id: "conv-1", leadId: "lead-1", unipileChatId: "chat-1" });
      p.inboundMessage.findMany.mockResolvedValue([
        { unipileMessageId: "earlier-echo", sender: "me-provider-id", content: "my own earlier send", receivedAt: new Date("2026-01-01") },
      ]);

      await UnipileService.handleWebhookEvent(validToken, validSecret, {
        event: "message_received",
        account_id: "acc-1",
        message_id: "msg-2",
        chat_id: "chat-1",
        text: "current candidate reply",
        account_info: { user_id: "me-provider-id" },
        sender: { attendee_provider_id: "candidate-provider-id" },
      });

      expect(p.conversationMessage.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ externalMessageId: "earlier-echo" }) })
      );
    });

    it("leaves an unmatched inbound message captured only in InboundMessage, without erroring, when no conversation matches", async () => {
      p.inboundMessage.findUnique.mockResolvedValue(null);
      p.inboundMessage.create.mockResolvedValue({ id: "inbound-1" });
      p.connectedAccount.findUnique.mockResolvedValue({ id: "conn-1", userId: "u1", accountName: "me@x.com", provider: "LINKEDIN" });
      p.conversation.findUnique.mockResolvedValue(null);
      p.conversation.findMany.mockResolvedValue([]);
      p.inboundMessage.findMany.mockResolvedValue([]);

      const result = await UnipileService.handleWebhookEvent(validToken, validSecret, {
        event: "message_received",
        account_id: "acc-1",
        message_id: "msg-1",
        chat_id: "chat-1",
        text: "unmatched candidate reply",
      });

      expect(result.status).toBe("processed");
      expect(result.inboundMessageId).toBe("inbound-1");
      expect(p.conversationMessage.create).not.toHaveBeenCalled();
    });
  });
});
