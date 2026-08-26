import axios from "axios";
import FormData from "form-data";
import crypto from "crypto";
import { config } from "../config";
import { prisma } from "../prisma";
import {
  AccountStatus,
  UnipileProvider,
  InteractionDirection,
  InteractionChannel,
  MessageSender,
  ConversationChannel,
  InboundChannel,
} from "@prisma/client";
import { processInboundMessage } from "./processInboundMessage";

// Exact, known Unipile account-status strings -> our AccountStatus enum.
// Deliberately an exact-match table, not substring matching: a status like
// "CREATION_SUCCESS" contains both "CREAT" and "SUCCESS", so any
// includes()-based check ends up ambiguous between two different real
// stages of the connect flow. See Documents/Unipile_Authentication_and_
// Subscription_Management_Implementation_Plan.md for what each string means.
const ACCOUNT_STATUS_MAP: Record<string, AccountStatus> = {
  CREATION_SUCCESS: AccountStatus.CONNECTING,
  SYNC_SUCCESS: AccountStatus.OK,
  RECONNECTED: AccountStatus.OK,
  CREDENTIALS: AccountStatus.RECONNECTION_NEEDED,
  PERMISSIONS: AccountStatus.PERMISSION_REVOKED,
  // No dedicated "failed" status exists in AccountStatus yet -- closest
  // existing bucket that still prompts the recruiter to act again.
  CREATION_FAIL: AccountStatus.RECONNECTION_NEEDED,
  DELETED: AccountStatus.DISCONNECTED,
};

function mapAccountStatus(raw: string): AccountStatus {
  const mapped = ACCOUNT_STATUS_MAP[raw.toUpperCase()];
  if (!mapped) {
    console.warn(`Unrecognized Unipile account status "${raw}" -- defaulting to OK. Add it to ACCOUNT_STATUS_MAP.`);
    return AccountStatus.OK;
  }
  return mapped;
}

// LinkedIn connection-request notes are capped at 300 characters on paid
// accounts and 200 on free accounts -- Unipile passes that limit straight
// through as a "too_many_characters" 400. Since we don't know the connected
// account's plan tier here, truncate to the conservative 200-char limit so
// invites don't fail regardless of tier, cutting on a word boundary rather
// than mid-word.
const INVITE_NOTE_MAX_CHARS = 200;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Unipile renders `body` as HTML, so a plain-text draft's "\n\n" paragraph
// breaks are just whitespace to the recipient's mail client and collapse
// into one run-on block (this was the actual bug behind the squashed-looking
// outreach emails) -- wrap each paragraph in its own <p> so the spacing the
// template author intended actually survives.
function plainTextToEmailHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 1em 0;">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function truncateForInviteNote(text: string, max: number = INVITE_NOTE_MAX_CHARS): string {
  if (text.length <= max) return text;
  const ellipsis = "…";
  const sliced = text.slice(0, max - ellipsis.length);
  const lastSpace = sliced.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? sliced.slice(0, lastSpace) : sliced;
  return `${cut.trimEnd()}${ellipsis}`;
}

export class UnipileService {
  private static getUnipileBaseUrl(): string {
    let dsn = (config.unipileDsn || "api25.unipile.com:15598").trim();
    if (!dsn.startsWith("http://") && !dsn.startsWith("https://")) {
      dsn = `https://${dsn}`;
    }
    dsn = dsn.replace(/\/+$/, "");
    if (!dsn.includes("/api/v1")) {
      dsn = `${dsn}/api/v1`;
    }
    return dsn;
  }

  private static getUnipileHostUrl(): string {
    let dsn = (config.unipileDsn || "api25.unipile.com:15598").trim();
    if (!dsn.startsWith("http://") && !dsn.startsWith("https://")) {
      dsn = `https://${dsn}`;
    }
    dsn = dsn.replace(/\/+$/, "");
    dsn = dsn.replace(/\/api\/v1\/?$/, "");
    return dsn;
  }

  private static getUnipileHeaders(extraHeaders: Record<string, string> = {}) {
    const apiKey = (config.unipileApiKey || "").trim();
    return {
      "X-API-KEY": apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...extraHeaders,
    };
  }

  /**
   * Mints a Unipile hosted-auth link for connecting LinkedIn/Email accounts
   */
  static async mintHostedAuthLink(
    userId: string,
    provider: string,
    mode: "create" | "reconnect" = "create",
    clientUrl?: string,
    rolePath: string = "/recruiter"
  ): Promise<{ url: string; nonce: string }> {
    const pUpper = (provider || "").toUpperCase();
    const validProviders = Object.values(UnipileProvider);
    if (!pUpper || !validProviders.includes(pUpper as UnipileProvider)) {
      throw { statusCode: 400, message: `Provider must be one of: ${validProviders.join(", ")}` };
    }
    const providerEnum = pUpper as UnipileProvider;

    let targetProviders: string[] = [providerEnum];
    let bypassSuccess = true;

    if (providerEnum === UnipileProvider.EMAIL) {
      targetProviders = ["MAIL", "GOOGLE", "OUTLOOK"];
      bypassSuccess = false;
    }

    // One connected account per user per provider group. A fresh "create"
    // link when the user already has a working (OK) connection for this
    // provider would mint a second, unrelated Unipile account -- the
    // reconnect-in-place logic in upsertConnectedAccountForUser would then
    // silently swap their existing connection out for it, which is only
    // correct when the user actually intended to re-authenticate the SAME
    // mailbox/profile (mode: "reconnect"), not when they just clicked
    // Connect again by mistake. EMAIL groups GOOGLE/OUTLOOK/MAIL/EMAIL
    // together since a hosted link minted for "EMAIL" can land as any of them.
    if (mode === "create") {
      const dedupeProviders =
        providerEnum === UnipileProvider.EMAIL
          ? [UnipileProvider.EMAIL, UnipileProvider.GOOGLE, UnipileProvider.OUTLOOK, UnipileProvider.MAIL]
          : [providerEnum];
      const existingConnected = await prisma.connectedAccount.findFirst({
        where: { userId, provider: { in: dedupeProviders }, status: AccountStatus.OK },
      });
      if (existingConnected) {
        throw {
          statusCode: 409,
          code: "ALREADY_CONNECTED",
          message: `You already have a connected ${provider} account (${existingConnected.accountName}). Disconnect it first, or use Reconnect to re-authenticate the same one.`,
        };
      }

      // Without this, a connect that appears stuck (webhook attribution
      // lagging or failing) invites the user to hit "Connect" again --
      // each click mints a brand-new Unipile-side account for the SAME real
      // LinkedIn/email profile, since Unipile has no idea it's a repeat.
      // That's the actual mechanism behind "multiple accounts via the same
      // profile": not a DB dedup gap, but nothing stopping a second in-flight
      // attempt while the first hasn't resolved yet. Block a new attempt
      // while an unexpired one for this provider group already exists.
      const pendingAttempt = await prisma.unipileAuthAttempt.findFirst({
        where: { userId, provider: { in: dedupeProviders }, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });
      if (pendingAttempt) {
        const minutesLeft = Math.max(1, Math.ceil((pendingAttempt.expiresAt.getTime() - Date.now()) / 60000));
        throw {
          statusCode: 409,
          code: "CONNECTION_PENDING",
          message: `A ${provider} connection is already in progress. If you closed that window without finishing, wait ${minutesLeft} more minute(s) for it to expire, then try again.`,
        };
      }
    }

    const nonce = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.unipileAuthAttempt.create({
      data: {
        userId,
        provider: providerEnum,
        nonce,
        expiresAt,
      },
    });

    const unipileBaseUrl = this.getUnipileBaseUrl();
    const unipileHostUrl = this.getUnipileHostUrl();
    const webhookNotifyUrl = `${config.appBaseUrl}/api/unipile/webhook/${config.unipileWebhookPathToken}`;

    const baseClient = (clientUrl || config.clientUrl).replace(/\/+$/, "");

    const payload = {
      type: mode,
      providers: targetProviders,
      api_url: unipileHostUrl,
      expiresOn: expiresAt.toISOString(),
      name: `g3_${userId}_${nonce}`,
      notify_url: webhookNotifyUrl,
      success_redirect_url: `${baseClient}${rolePath}?status=connected&provider=${providerEnum}`,
      failure_redirect_url: `${baseClient}${rolePath}?status=failed&provider=${providerEnum}`,
      bypass_success_screen: bypassSuccess,
      single_use: true,
    };

    const targetUrl = `${unipileBaseUrl}/hosted/accounts/link`;
    const response = await axios.post(targetUrl, payload, {
      headers: this.getUnipileHeaders({ "Content-Type": "application/json" }),
    });

    return { url: response.data.url, nonce };
  }

  /**
   * Get connected accounts for a specific user, syncing with Unipile API
   */
  static async getUserConnectedAccounts(userId: string) {
    try {
      const unipileBaseUrl = this.getUnipileBaseUrl();
      const response = await axios.get(`${unipileBaseUrl}/accounts`, {
        headers: this.getUnipileHeaders(),
        timeout: 4000,
      });
      const items = response.data?.items || response.data || [];
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          // `/accounts` is scoped to the whole Unipile API key, i.e. every
          // user's accounts, not just this one, and (unlike the webhook's
          // `body.name`) items here carry no correlator back to our
          // UnipileAuthAttempt -- `item.name` is the account's own
          // display name/email, not our `g3_${userId}_${nonce}` string.
          const existing = await prisma.connectedAccount.findUnique({
            where: { unipileAccountId: item.id },
          });
          // SECURITY: never attribute an unclaimed account to whichever user
          // happens to be polling. This used to fall through to a "best
          // effort" guess (findRecentAttemptForProvider) that matched on
          // nothing more than "this viewer created some connect attempt for
          // this provider at some point" -- no correlation to the specific
          // account, no expiry check, no single-use check. Since the dialog
          // polls every few seconds for ANY user who has it open, whichever
          // user's poll happened to run first in the brief window before the
          // notify_url webhook landed would silently claim a DIFFERENT
          // user's real LinkedIn/email account. Confirmed live: this is
          // exactly how one user's connection ended up attributed to two
          // other people's accounts in sequence.
          //
          // The webhook (handleWebhookEvent -> resolveAuthAttemptFromName)
          // is the only path that can prove which user an account belongs
          // to, via the exact nonce minted in mintHostedAuthLink. This sync
          // loop is now read-only for un-attributed accounts: it refreshes
          // the status of accounts THIS user already legitimately owns, and
          // otherwise waits for the webhook -- it never claims anything.
          if (!existing || existing.userId !== userId) continue;

          const rawProvider = (item.provider || item.type || "").toUpperCase();
          let provider: UnipileProvider = UnipileProvider.EMAIL;
          if (rawProvider.includes("LINKEDIN")) provider = UnipileProvider.LINKEDIN;
          else if (rawProvider.includes("GOOGLE")) provider = UnipileProvider.GOOGLE;
          else if (rawProvider.includes("OUTLOOK")) provider = UnipileProvider.OUTLOOK;
          else if (rawProvider.includes("MAIL")) provider = UnipileProvider.MAIL;

          const rawStatus = (item.status || "OK").toUpperCase();
          const mappedStatus = rawStatus === "OK" || rawStatus === "CONNECTED" ? AccountStatus.OK : AccountStatus.RECONNECTION_NEEDED;
          const accountName = item.name || item.username || `${provider} Account`;

          await this.upsertConnectedAccountForUser(userId, provider, item.id, accountName, mappedStatus, rawStatus);
        }
      }
    } catch (err: any) {
      console.warn("Could not sync live Unipile accounts:", err.message);
    }

    return prisma.connectedAccount.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Writes a ConnectedAccount for this user+provider, respecting the
   * `@@unique([userId, provider])` DB constraint. Every reconnect of the same
   * mailbox/LinkedIn profile mints a brand new Unipile account id, so a plain
   * upsert-by-id tries to INSERT a second row for a provider this user
   * already has -- which violates that constraint and either throws (in the
   * webhook handler, killing the whole webhook call) or gets silently
   * swallowed (in the old sync loop's `.catch(() => null)`), so the
   * reconnect just vanishes and the recruiter sees nothing happen. Instead:
   * if this user already has a row for this provider under a *different*
   * unipileAccountId, treat it as a replace (update in place); otherwise
   * upsert normally by id.
   */
  private static async upsertConnectedAccountForUser(
    userId: string,
    provider: UnipileProvider,
    unipileAccountId: string,
    accountName: string,
    status: AccountStatus,
    statusMessage: string
  ) {
    const existingForProvider = await prisma.connectedAccount.findUnique({
      where: { userId_provider: { userId, provider } },
    });

    if (existingForProvider && existingForProvider.unipileAccountId !== unipileAccountId) {
      return prisma.connectedAccount.update({
        where: { id: existingForProvider.id },
        data: { unipileAccountId, accountName, status, statusMessage },
      }).catch((err) => {
        console.warn("Failed to replace reconnected account:", err.message);
        return null;
      });
    }

    return prisma.connectedAccount.upsert({
      where: { unipileAccountId },
      create: { userId, provider, unipileAccountId, accountName, status, statusMessage },
      update: { status, statusMessage, accountName },
    }).catch((err) => {
      console.warn("Failed to upsert connected account:", err.message);
      return null;
    });
  }

  /**
   * Disconnect an account in Unipile & mark DISCONNECTED in DB
   */
  static async disconnectAccount(userId: string, unipileAccountId: string) {
    const acc = await prisma.connectedAccount.findFirst({
      where: { userId, unipileAccountId },
    });

    if (!acc) {
      throw { statusCode: 404, message: "Connected account not found for this user" };
    }

    try {
      const unipileBaseUrl = this.getUnipileBaseUrl();
      await axios.delete(`${unipileBaseUrl}/accounts/${unipileAccountId}`, {
        headers: this.getUnipileHeaders(),
      });
    } catch (err: any) {
      console.warn("Unipile delete account API warning:", err?.response?.data || err.message);
    }

    return prisma.connectedAccount.update({
      where: { unipileAccountId },
      data: {
        status: AccountStatus.DISCONNECTED,
        statusMessage: "Disconnected by user",
      },
    });
  }

  /**
   * Smart LinkedIn message outreach with automatic 1st-degree DM or 2nd/3rd degree Invite fallback
   */
  static async sendLinkedInMessage(
    userId: string,
    leadId: string,
    profileUrlOrId: string,
    text: string,
    preferredAccountId?: string
  ) {
    // 1. Find user's active LinkedIn account
    let connectedAcc: any = null;
    if (preferredAccountId) {
      connectedAcc = await prisma.connectedAccount.findFirst({
        where: { userId, unipileAccountId: preferredAccountId, status: AccountStatus.OK },
      });
    }
    if (!connectedAcc) {
      connectedAcc = await prisma.connectedAccount.findFirst({
        where: { userId, provider: UnipileProvider.LINKEDIN, status: AccountStatus.OK },
      });
    }

    if (!connectedAcc) {
      throw {
        statusCode: 409,
        code: "ACCOUNT_NOT_CONNECTED",
        message: "LinkedIn account not connected or requires reconnection. Please connect your account first.",
      };
    }

    const account_id = connectedAcc.unipileAccountId;

    let cleanIdentifier = (profileUrlOrId || "").trim();
    if (cleanIdentifier.includes("linkedin.com/in/")) {
      const match = cleanIdentifier.match(/linkedin\.com\/in\/([^\/\?#]+)/);
      if (match) cleanIdentifier = match[1];
    }

    const unipileBaseUrl = this.getUnipileBaseUrl();
    const headers = this.getUnipileHeaders();

    // Step 1: Profile lookup
    let userProfile: any = null;
    try {
      const profileRes = await axios.get(
        `${unipileBaseUrl}/users/${encodeURIComponent(cleanIdentifier)}?account_id=${account_id}`,
        { headers }
      );
      userProfile = profileRes.data;
    } catch (err: any) {
      console.warn(`LinkedIn profile lookup failed for ${cleanIdentifier}, proceeding directly:`, err.message);
    }

    const providerId = userProfile?.provider_id || cleanIdentifier;
    let mode = "direct_message";
    let externalMessageId: string | null = null;
    let unipileChatId: string | null = null;
    let responseData: any = null;

    // Step 2: 2nd/3rd degree -> Send Connection Invite with Note
    if (userProfile?.network_distance && userProfile.network_distance !== "FIRST_DEGREE") {
      try {
        const inviteRes = await axios.post(
          `${unipileBaseUrl}/users/invite`,
          {
            account_id,
            provider_id: providerId,
            message: truncateForInviteNote(text),
          },
          { headers: { ...headers, "Content-Type": "application/json" } }
        );
        mode = "connection_invite";
        responseData = inviteRes.data;
        // Confirmed live: `id`/`invitation_id` here is LinkedIn's invitation
        // id (e.g. "7498301028656902144"), a completely different id space
        // from the real chat id Unipile's message webhooks use (e.g.
        // "vYCl26x0V0WeDp2ETbClZg") -- so unlike the direct_message branch
        // below, do NOT fall back to `.id` for unipileChatId here; that would
        // store the invitation id as if it were a chat id, which would just
        // as permanently prevent replies from ever matching, but silently.
        // Only trust an explicit chat_id if Unipile's invite response ever
        // includes one -- otherwise leave it null and rely on the webhook
        // backfill in handleWebhookEvent (see "self-echo" comment there),
        // which learns the real chat id from Unipile itself once the
        // resulting thread shows up in a message_received event.
        externalMessageId = responseData?.id || responseData?.invitation_id || `inv_${Date.now()}`;
        unipileChatId = responseData?.chat_id || null;
      } catch (inviteErr: any) {
        console.warn("Invite attempt failed, falling back to direct message:", inviteErr?.response?.data || inviteErr.message);
      }
    }

    // Step 3: Direct DM attempt if not already sent via Invite
    if (!responseData) {
      try {
        const form = new FormData();
        form.append("account_id", account_id);
        form.append("attendees_ids", providerId);
        form.append("text", text);

        const formHeaders = this.getUnipileHeaders(form.getHeaders() as Record<string, string>);
        const chatRes = await axios.post(`${unipileBaseUrl}/chats`, form, { headers: formHeaders });

        mode = "direct_message";
        responseData = chatRes.data;
        externalMessageId = responseData?.id || responseData?.chat_id || `msg_${Date.now()}`;
        // The chat/thread id itself (as distinct from this one message's id) --
        // used to correlate future inbound replies back to this conversation.
        unipileChatId = responseData?.chat_id || responseData?.id || null;
      } catch (dmErr: any) {
        // Fallback: Connection request with note
        try {
          const inviteRes = await axios.post(
            `${unipileBaseUrl}/users/invite`,
            {
              account_id,
              provider_id: providerId,
              message: truncateForInviteNote(text),
            },
            { headers: { ...headers, "Content-Type": "application/json" } }
          );
          mode = "connection_invite_fallback";
          responseData = inviteRes.data;
          // Same invitation-id-vs-chat-id distinction as the Step 2 invite
          // branch above -- don't fall back to `.id` for unipileChatId here.
          externalMessageId = responseData?.id || responseData?.invitation_id || `inv_${Date.now()}`;
          unipileChatId = responseData?.chat_id || null;
        } catch (fallbackErr: any) {
          const details = fallbackErr?.response?.data || fallbackErr.message;
          throw new Error(`Failed to send LinkedIn DM or Invite: ${JSON.stringify(details)}`);
        }
      }
    }

    // Save InteractionEvent in DB
    const event = await prisma.interactionEvent.create({
      data: {
        leadId,
        direction: InteractionDirection.OUTBOUND,
        channel: InteractionChannel.LINKEDIN_DM,
        recruiterId: userId,
        occurredAt: new Date(),
        sentText: text,
        deliveryStatus: mode,
        externalMessageId,
      },
    });

    // Also sync to Conversation table
    await this.syncToConversation(leadId, userId, "LINKEDIN", text, externalMessageId, unipileChatId);

    return {
      success: true,
      mode,
      externalMessageId,
      eventId: event.id,
      data: responseData,
    };
  }

  /**
   * Send tracked email via Unipile
   */
  static async sendEmail(
    userId: string,
    leadId: string,
    toEmail: string,
    subject: string,
    body: string,
    preferredAccountId?: string
  ) {
    // Find active Email account
    let connectedAcc: any = null;
    if (preferredAccountId) {
      connectedAcc = await prisma.connectedAccount.findFirst({
        where: { userId, unipileAccountId: preferredAccountId, status: AccountStatus.OK },
      });
    }
    if (!connectedAcc) {
      connectedAcc = await prisma.connectedAccount.findFirst({
        where: {
          userId,
          provider: { in: [UnipileProvider.GOOGLE, UnipileProvider.MAIL, UnipileProvider.OUTLOOK, UnipileProvider.EMAIL] },
          status: AccountStatus.OK,
        },
      });
    }

    if (!connectedAcc) {
      throw {
        statusCode: 409,
        code: "ACCOUNT_NOT_CONNECTED",
        message: "Email account not connected or requires reconnection. Please connect your Email account first.",
      };
    }

    const account_id = connectedAcc.unipileAccountId;
    const unipileBaseUrl = this.getUnipileBaseUrl();

    const payload = {
      account_id,
      to: [
        {
          identifier: toEmail.trim(),
          display_name: "",
        },
      ],
      subject,
      body: plainTextToEmailHtml(body),
      tracking_options: {
        opens: true,
        links: true,
        label: "global3-outreach",
      },
    };

    const response = await axios.post(`${unipileBaseUrl}/emails`, payload, {
      headers: this.getUnipileHeaders({ "Content-Type": "application/json" }),
    });

    const externalMessageId = response.data.tracking_id || response.data.id || `mail_${Date.now()}`;

    // Record InteractionEvent
    const event = await prisma.interactionEvent.create({
      data: {
        leadId,
        direction: InteractionDirection.OUTBOUND,
        channel: InteractionChannel.EMAIL,
        recruiterId: userId,
        occurredAt: new Date(),
        sentText: body,
        deliveryStatus: "sent",
        externalMessageId,
      },
    });

    // Also sync to Conversation table (same as LinkedIn's sendLinkedInMessage)
    await this.syncToConversation(leadId, userId, "EMAIL", body, externalMessageId);

    return {
      success: true,
      externalMessageId,
      eventId: event.id,
      data: response.data,
    };
  }

  /**
   * Helper to sync outbound message to Conversation & ConversationMessage models
   */
  private static async syncToConversation(
    leadId: string,
    recruiterId: string,
    channel: "LINKEDIN" | "EMAIL",
    text: string,
    externalMessageId: string | null,
    unipileChatId: string | null = null
  ) {
    try {
      const lead = await prisma.lead.findUnique({ where: { id: leadId } });
      const candidateName = lead?.fullName || lead?.firstName || "Candidate";

      let conv = await prisma.conversation.findFirst({
        where: { leadId, recruiterId },
      });

      if (!conv) {
        conv = await prisma.conversation.create({
          data: {
            leadId,
            recruiterId,
            candidateName,
            channel: channel === "LINKEDIN" ? ConversationChannel.LINKEDIN : ConversationChannel.SMS,
            lastMessageAt: new Date(),
            unipileChatId: unipileChatId || undefined,
          },
        });
      } else {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            lastMessageAt: new Date(),
            // Backfill the chat id the first time we actually learn it (e.g. the
            // first message went via invite with no chat id, a later one succeeds).
            ...(unipileChatId && !conv.unipileChatId ? { unipileChatId } : {}),
          },
        });
      }

      await prisma.conversationMessage.create({
        data: {
          conversationId: conv.id,
          sender: MessageSender.ME,
          text,
          externalMessageId,
        },
      });
    } catch (err: any) {
      console.warn("Failed to sync Conversation record:", err.message);
    }
  }

  /**
   * Resolve the UnipileAuthAttempt that a notify_url callback belongs to, via
   * the nonce embedded in `name` at mint time (`g3_${userId}_${nonce}`) --
   * NOT "whichever attempt happens to be newest," which would misattribute a
   * new connection whenever two users are connecting accounts around the
   * same time.
   */
  private static async resolveAuthAttemptFromName(name: string | undefined) {
    if (!name) return null;
    const nonce = name.slice(name.lastIndexOf("_") + 1);
    if (!nonce) return null;
    return prisma.unipileAuthAttempt.findUnique({ where: { nonce } });
  }

  /**
   * Unified Webhook Event Handler (Idempotent & Deduplicated)
   */
  static async handleWebhookEvent(token: string, secretHeader: string | undefined, body: any) {
    if (token !== config.unipileWebhookPathToken) {
      throw { statusCode: 401, message: "Invalid webhook path token" };
    }

    if (secretHeader !== config.unipileWebhookSecret) {
      throw { statusCode: 401, message: "Invalid webhook secret header" };
    }

    // Deduplicate via SHA256 of body
    const bodyStr = JSON.stringify(body || {});
    const dedupeKey = crypto.createHash("sha256").update(bodyStr).digest("hex");

    const existing = await prisma.unipileWebhookEvent.findUnique({ where: { dedupeKey } });
    if (existing) {
      return { status: "already_processed", id: existing.id };
    }

    const eventType = body.event || body.AccountStatus?.message || body.status || "unknown_event";

    await prisma.unipileWebhookEvent.create({
      data: {
        dedupeKey,
        eventType,
        payload: body,
      },
    });

    // 1. Account status webhook handling
    const accountId = body.AccountStatus?.account_id ?? body.account_id ?? null;
    const rawStatus = body.AccountStatus?.message ?? body.status ?? body.event ?? null;

    if (accountId && rawStatus) {
      const mappedStatus = mapAccountStatus(rawStatus);

      let connAcc = await prisma.connectedAccount.findUnique({
        where: { unipileAccountId: accountId },
      });

      if (!connAcc) {
        // Only reachable on the very first callback for this account. The
        // specific provider type as Unipile itself reports it (GOOGLE_OAUTH,
        // LINKEDIN, etc.) -- computed once, used both for attempt matching
        // and for the ConnectedAccount row itself, so it's never out of sync
        // between the two.
        const rawProviderType = (body.AccountStatus?.account_type || body.account_type || "").toUpperCase();
        let specificProvider: UnipileProvider | null = null;
        if (rawProviderType.includes("LINKEDIN")) specificProvider = UnipileProvider.LINKEDIN;
        else if (rawProviderType.includes("GOOGLE")) specificProvider = UnipileProvider.GOOGLE;
        else if (rawProviderType.includes("OUTLOOK")) specificProvider = UnipileProvider.OUTLOOK;
        else if (rawProviderType.includes("MAIL")) specificProvider = UnipileProvider.MAIL;

        let attempt = await this.resolveAuthAttemptFromName(body.name);

        if (!attempt) {
          // FALLBACK: confirmed live (2026-08-26) that Unipile's
          // dashboard-registered account_status webhook -- as opposed to the
          // per-request notify_url -- never echoes back our minted name/nonce
          // at all (every real CREATION_SUCCESS event observed arrived with
          // body.name undefined; notify_url's own named payload shape never
          // appeared even once). This is the only account-status delivery
          // that actually fires in this environment, so without a fallback
          // no new account is ever attributed to anyone.
          //
          // SECURITY: this must NOT repeat the original bug (matching any
          // historical attempt by whichever user happened to be polling).
          // Match only an UNEXPIRED UnipileAuthAttempt for the same provider
          // GROUP, and ONLY when there is EXACTLY ONE such candidate system-
          // wide at this instant. If more than one unexpired attempt exists
          // for the same group (two people connecting concurrently), refuse
          // and log rather than guess between them -- ambiguity must never be
          // resolved by picking one, that's exactly what caused the
          // cross-user attribution incident. The attempt is deleted
          // immediately after a successful match so it can never be reused
          // (single-use, same guarantee `single_use: true` gives Unipile's
          // own side of the link).
          //
          // BUG FIX: every hosted link for GOOGLE/OUTLOOK/MAIL is minted
          // under the generic EMAIL provider (see mintHostedAuthLink -- one
          // link targets all three), so the stored UnipileAuthAttempt.provider
          // is EMAIL, never the specific resolved type. Matching only on the
          // specific type (e.g. GOOGLE) against attempts stored as EMAIL
          // silently found zero candidates every time -- confirmed live, this
          // is why the fallback never actually attributed anything.
          //
          // BUG FIX 2: if `account_type` is absent or spelled differently
          // than expected in this webhook's actual payload, specificProvider
          // stays null -- and gating the whole candidate lookup on
          // `if (specificProvider)` meant we NEVER even looked for a
          // candidate in that case, guaranteeing "No UnipileAuthAttempt
          // matched" regardless of whether exactly one pending attempt truly
          // existed. Payload field names for this webhook have already been
          // wrong once (see BUG FIX above) so don't gate on it a second time
          // -- fall back to searching across every unexpired attempt
          // (LINKEDIN + EMAIL group) when we can't resolve a specific type.
          // The exactly-one-candidate safety rule still applies either way.
          const candidateProviders = specificProvider
            ? specificProvider === UnipileProvider.LINKEDIN
              ? [UnipileProvider.LINKEDIN]
              : [UnipileProvider.EMAIL, specificProvider]
            : [UnipileProvider.LINKEDIN, UnipileProvider.EMAIL];
          const candidates = await prisma.unipileAuthAttempt.findMany({
            where: { provider: { in: candidateProviders }, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: "desc" },
          });
          if (candidates.length === 1) {
            attempt = candidates[0];
          } else if (candidates.length > 1) {
            console.warn(
              `[unipile webhook] Ambiguous attribution for new ${specificProvider || "unknown-type"} account ${accountId}: ${candidates.length} concurrent unexpired connect attempts -- refusing to guess between them.`
            );
          } else {
            console.warn(
              `[unipile webhook] No unexpired UnipileAuthAttempt candidates for new account ${accountId} (resolved type=${specificProvider || "unresolved, raw=" + rawProviderType}). Raw payload: ${JSON.stringify(body).slice(0, 500)}`
            );
          }
        }

        if (attempt) {
          // Goes through the same userId+provider-aware helper as the manual
          // sync path -- a recruiter reconnecting (new Unipile account id,
          // same provider) must replace their existing row, not attempt a
          // second INSERT that violates @@unique([userId, provider]) and
          // throws, which would otherwise fail this whole webhook call and
          // make the reconnect look like it silently didn't work. Prefer the
          // specific resolved provider (GOOGLE/OUTLOOK/MAIL/LINKEDIN) over the
          // attempt's own generic EMAIL for storage, matching how every other
          // ConnectedAccount row in the system is typed.
          const storedProvider = specificProvider || attempt.provider;
          connAcc = await this.upsertConnectedAccountForUser(
            attempt.userId,
            storedProvider,
            accountId,
            body.name || body.account_name || `${storedProvider} Account`,
            mappedStatus,
            rawStatus
          );
          // Single-use: burn the attempt immediately so it can never be
          // matched again, by this fallback or the nonce path.
          await prisma.unipileAuthAttempt.delete({ where: { id: attempt.id } }).catch(() => {});
        } else {
          console.warn(`No UnipileAuthAttempt matched for new account ${accountId} (name=${body.name}) -- dropping status update.`);
        }
      } else {
        if (connAcc.status !== mappedStatus) {
          await prisma.accountDegradation.create({
            data: {
              connectedAccountId: connAcc.id,
              fromStatus: connAcc.status,
              toStatus: mappedStatus,
              reason: rawStatus,
            },
          });

          await prisma.connectedAccount.update({
            where: { id: connAcc.id },
            data: {
              status: mappedStatus,
              statusMessage: rawStatus,
            },
          });
        }
      }
    }

    // 2. Email tracking webhooks (mail_opened, mail_link_clicked)
    const trackingId = body.tracking_id || body.email_id;
    if (trackingId) {
      const eventName = body.event;
      let newDeliveryStatus: string | null = null;
      if (eventName === "mail_opened") newDeliveryStatus = "opened";
      if (eventName === "mail_link_clicked") newDeliveryStatus = "clicked";

      if (newDeliveryStatus) {
        await prisma.interactionEvent.updateMany({
          where: { externalMessageId: trackingId },
          data: { deliveryStatus: newDeliveryStatus },
        });
      }
    }

    // 3. Messaging webhook (inbound and external outbound) per Unipile Metrics Guide
    // Handles both LinkedIn (message_received) and Email (email.received) events.
    const isMessageEvent = eventType === "message_received" || eventType === "email.received";
    const inboundChannel = eventType === "email.received" ? InboundChannel.EMAIL : InboundChannel.LINKEDIN;

    let inboundMessageId: string | null = null;

    if (isMessageEvent && (body.message || body.text || body.body) && accountId) {
      const connAcc = await prisma.connectedAccount.findUnique({
        where: { unipileAccountId: accountId },
      });

      const messageText = body.message || body.text || body.body || "";
      const externalMsgId = body.message_id || body.id || null;

      // --- InboundMessage table insert (idempotency via unipile_message_id) ---
      if (externalMsgId) {
        const existingInbound = await prisma.inboundMessage.findUnique({
          where: { unipileMessageId: externalMsgId },
        });

        if (existingInbound) {
          // Already stored — return 200 immediately, do nothing else.
          return { status: "already_processed", inboundMessageId: existingInbound.id, dedupeKey };
        }

        // Provider timestamp (acknowledged send time per Unipile guide, with safe NaN fallback)
        let eventTimestamp = new Date();
        if (body.timestamp) {
          const parsed = new Date(body.timestamp);
          if (!isNaN(parsed.getTime())) eventTimestamp = parsed;
        }

        const senderName = body.sender?.display_name || body.sender?.attendee_provider_id
          || body.from?.identifier || body.from?.display_name || body.sender_id || "unknown";
        const chatId = body.chat_id || body.thread_id || null;

        const inboundRow = await prisma.inboundMessage.create({
          data: {
            unipileMessageId: externalMsgId,
            channel: inboundChannel,
            accountId,
            threadId: chatId,
            sender: senderName,
            content: messageText,
            receivedAt: eventTimestamp,
          },
        });
        inboundMessageId = inboundRow.id;
      }

      // --- ConversationMessage + InteractionEvent (existing logic, now for both channels) ---
      if (connAcc) {
        const providerUserId = body.account_info?.user_id;
        const senderProviderId = body.sender?.attendee_provider_id || body.sender_id;
        const isOutbound = (providerUserId && senderProviderId && providerUserId === senderProviderId) || body.is_sender === true;

        let eventTimestamp = new Date();
        if (body.timestamp) {
          const parsed = new Date(body.timestamp);
          if (!isNaN(parsed.getTime())) eventTimestamp = parsed;
        }

        const chatId = body.chat_id || body.thread_id || null;

        // SECURITY/CORRECTNESS: only attach to a conversation we can positively
        // identify by chat id. This used to fall back to "this recruiter's
        // most recently active conversation" when chatId didn't match --
        // same class of bug as the account-attribution issue: guessing
        // instead of only acting on a confirmed match. A reply from Candidate
        // A on a not-yet-tracked thread would silently land in Candidate B's
        // conversation just because B was the recruiter's last activity. The
        // InboundMessage row above is already captured unconditionally
        // (verbatim, keyed by chatId as threadId) regardless of whether we
        // can resolve a Conversation here, so nothing is lost by not guessing
        // -- it's just not surfaced in the Conversations UI until it can be
        // matched with certainty.
        let conversation = chatId
          ? await prisma.conversation.findUnique({ where: { unipileChatId: chatId } })
          : null;

        // Self-echo backfill: sendLinkedInMessage's invite-with-note path (the
        // common case for 2nd/3rd-degree cold outreach) never learns Unipile's
        // real chat id at send time -- LinkedIn only creates the thread once
        // the note lands, and the invite API response only ever returns the
        // invitation id, a different id space entirely (confirmed live: our
        // own recorded externalMessageId for an invite was LinkedIn's numeric
        // invitation id, not the alphanumeric chat id the message webhook
        // later reported for the same thread). Unipile echoes our OWN sent
        // message back through this same webhook (isOutbound === true)
        // carrying that real chat_id -- the only ground truth we get. Match
        // it to the Conversation created synchronously at send time by exact
        // outbound text + same recruiter + not yet backfilled. Never guess:
        // refuse if more than one Conversation is an equally exact match
        // (e.g. the identical template sent to two leads back to back).
        if (!conversation && chatId && isOutbound && connAcc) {
          const candidates = await prisma.conversation.findMany({
            where: {
              recruiterId: connAcc.userId,
              unipileChatId: null,
              messages: { some: { sender: MessageSender.ME, text: messageText } },
            },
          });
          if (candidates.length === 1) {
            conversation = await prisma.conversation.update({
              where: { id: candidates[0].id },
              data: { unipileChatId: chatId },
            });
            console.log(`[unipile webhook] Backfilled chat id ${chatId} onto conversation ${conversation.id} via self-echo match.`);
          } else if (candidates.length > 1) {
            console.warn(`[unipile webhook] Ambiguous self-echo backfill for chatId=${chatId}: ${candidates.length} candidate conversations share identical outbound text -- refusing to guess.`);
          }
        }

        // Webhook delivery order across two events of the same send (our
        // echo vs. the candidate's real reply) isn't guaranteed -- confirmed
        // live, the real reply was processed before its own echo, so the
        // reply's earlier attempt at this same match found nothing yet and
        // was dropped into InboundMessage-only. Once a chat id resolves
        // (above), catch up on any other InboundMessage rows for this exact
        // thread that are still missing from the conversation, in receipt
        // order, before handling the current event below. Only ever surface
        // the OTHER party's messages here -- our own outbound messages are
        // already recorded synchronously at send time (syncToConversation),
        // so re-inserting an echo would just duplicate (or, worse, mislabel)
        // something already shown. Direction is decided by comparing each
        // row's stored sender identity against THIS event's own -- the only
        // two participants possible in a 1:1 thread are us and the other
        // party, so an exact non-match is always "them," never a guess
        // between multiple candidates.
        if (conversation && chatId) {
          const priorUnmatched = await prisma.inboundMessage.findMany({
            where: { threadId: chatId, channel: inboundChannel },
            orderBy: { receivedAt: "asc" },
          });
          for (const prior of priorUnmatched) {
            if (prior.unipileMessageId === externalMsgId) continue; // this event, handled below
            const priorIsOutbound = prior.sender === senderProviderId;
            if (priorIsOutbound) continue; // our own echo -- already recorded at send time
            const already = await prisma.conversationMessage.findFirst({
              where: { externalMessageId: prior.unipileMessageId },
            });
            if (already) continue;
            await prisma.conversationMessage.create({
              data: {
                conversationId: conversation.id,
                sender: MessageSender.THEM,
                text: prior.content,
                externalMessageId: prior.unipileMessageId,
                sentAt: prior.receivedAt,
              },
            });
            await prisma.conversation.update({
              where: { id: conversation.id },
              data: {
                unread: true,
                lastMessageAt: prior.receivedAt,
              },
            });
          }
        }

        if (!conversation && chatId) {
          console.warn(`[unipile webhook] No Conversation matched chatId=${chatId} for account ${accountId} -- message captured in InboundMessage only, not surfaced in Conversations UI.`);
        }

        // Every outbound send in this app goes through sendLinkedInMessage,
        // which already writes its own ConversationMessage/InteractionEvent
        // synchronously at send time (syncToConversation) -- so a webhook
        // echo of our own message (isOutbound) is never new information here,
        // only useful above for learning the real chat id. Inserting it again
        // would at best duplicate that message and at worst mislabel it as
        // coming from the candidate if isOutbound is ever computed wrong (as
        // confirmed happened live: identical-looking payload, `sender: THEM`
        // ended up stored regardless -- never trust this branch with content
        // that's already ours by construction). Only ever insert the other
        // party's real reply here.
        if (conversation && !isOutbound) {
          // Idempotency: prevent double-inserting if externalMessageId already exists
          const existingMsg = externalMsgId
            ? await prisma.conversationMessage.findFirst({ where: { externalMessageId: externalMsgId } })
            : null;

          if (!existingMsg) {
            await prisma.conversationMessage.create({
              data: {
                conversationId: conversation.id,
                sender: MessageSender.THEM,
                text: messageText,
                externalMessageId: externalMsgId,
                sentAt: eventTimestamp,
              },
            });

            await prisma.interactionEvent.create({
              data: {
                leadId: conversation.leadId,
                recruiterId: connAcc.userId,
                direction: InteractionDirection.INBOUND,
                channel: connAcc.provider === "LINKEDIN" ? InteractionChannel.LINKEDIN_DM : InteractionChannel.EMAIL,
                occurredAt: eventTimestamp,
                sentText: messageText,
                deliveryStatus: "received",
                externalMessageId: externalMsgId,
              },
            });

            await prisma.conversation.update({
              where: { id: conversation.id },
              data: {
                unread: true,
                lastMessageAt: eventTimestamp,
              },
            });
          }
        }
      }
    }

    return { status: "processed", dedupeKey, inboundMessageId };
  }
}
