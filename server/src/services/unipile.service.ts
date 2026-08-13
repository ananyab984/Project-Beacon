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
} from "@prisma/client";

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
          const rawProvider = (item.provider || item.type || "").toUpperCase();
          let provider: UnipileProvider = UnipileProvider.EMAIL;
          if (rawProvider.includes("LINKEDIN")) provider = UnipileProvider.LINKEDIN;
          else if (rawProvider.includes("GOOGLE")) provider = UnipileProvider.GOOGLE;
          else if (rawProvider.includes("OUTLOOK")) provider = UnipileProvider.OUTLOOK;
          else if (rawProvider.includes("MAIL")) provider = UnipileProvider.MAIL;

          const rawStatus = (item.status || "OK").toUpperCase();
          const mappedStatus = rawStatus === "OK" || rawStatus === "CONNECTED" ? AccountStatus.OK : AccountStatus.RECONNECTION_NEEDED;

          await prisma.connectedAccount.upsert({
            where: { unipileAccountId: item.id },
            create: {
              userId,
              provider,
              unipileAccountId: item.id,
              accountName: item.name || item.username || `${provider} Account`,
              status: mappedStatus,
              statusMessage: rawStatus,
            },
            update: {
              userId,
              status: mappedStatus,
              statusMessage: rawStatus,
              accountName: item.name || item.username || undefined,
            },
          }).catch(() => null);
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
        externalMessageId = responseData?.id || responseData?.invitation_id || `inv_${Date.now()}`;
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
          externalMessageId = responseData?.id || responseData?.invitation_id || `inv_${Date.now()}`;
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
      body,
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
        // Only reachable on the very first callback for this account -- the
        // notify_url stage, which is also the only stage that carries `name`.
        const attempt = await this.resolveAuthAttemptFromName(body.name);

        if (attempt) {
          connAcc = await prisma.connectedAccount.upsert({
            where: { unipileAccountId: accountId },
            create: {
              userId: attempt.userId,
              provider: attempt.provider,
              unipileAccountId: accountId,
              accountName: body.name || body.account_name || `${attempt.provider} Account`,
              status: mappedStatus,
              statusMessage: rawStatus,
            },
            update: {
              status: mappedStatus,
              statusMessage: rawStatus,
            },
          });
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

    // 3. Inbound Messaging webhook
    if (eventType === "message_received" && body.sender_name && body.message && accountId) {
      const connAcc = await prisma.connectedAccount.findUnique({
        where: { unipileAccountId: accountId },
      });

      if (connAcc) {
        // Echo filter: ignore if message came from ourselves
        if (body.sender_id && body.sender_id === accountId) {
          return { status: "ignored_echo" };
        }

        // Match by the actual chat/thread id first -- only fall back to
        // "recruiter's most recent conversation" (logged clearly as a
        // best-effort guess) if the webhook payload doesn't carry one or we
        // haven't recorded it yet, so a busy recruiter with multiple active
        // candidate threads doesn't get replies misfiled by default.
        const chatId = body.chat_id || body.thread_id || null;
        let conversation = chatId
          ? await prisma.conversation.findUnique({ where: { unipileChatId: chatId } })
          : null;

        if (!conversation) {
          console.warn(
            `Inbound message for account ${accountId} has no matching chat id (chat_id=${chatId}) -- ` +
              `falling back to most-recently-active conversation for this recruiter as a best effort.`
          );
          conversation = await prisma.conversation.findFirst({
            where: { recruiterId: connAcc.userId },
            orderBy: { lastMessageAt: "desc" },
          });
        }

        if (conversation) {
          await prisma.conversationMessage.create({
            data: {
              conversationId: conversation.id,
              sender: MessageSender.THEM,
              text: body.message,
              externalMessageId: body.message_id || null,
            },
          });

          await prisma.interactionEvent.create({
            data: {
              leadId: conversation.leadId,
              direction: InteractionDirection.INBOUND,
              channel: InteractionChannel.LINKEDIN_DM,
              occurredAt: new Date(),
              sentText: body.message,
              deliveryStatus: "received",
              externalMessageId: body.message_id || null,
            },
          });

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { unread: true, lastMessageAt: new Date() },
          });
        }
      }
    }

    return { status: "processed", dedupeKey };
  }
}
