import axios from "axios";

/**
 * Shared chat.postMessage call -- both sendSlackDm and sendSlackCard funnel
 * through here so the bot-token check, endpoint and error handling exist
 * exactly once. Uses axios directly against Slack's Web API rather than
 * pulling in the @slack/web-api SDK -- these two calls don't earn a new
 * dependency when axios is already used everywhere else in this service
 * layer. Silently no-ops if the bot isn't configured yet -- matches the
 * spec: "nothing breaks."
 *
 * The bot token is a secret, not org-configuration -- it lives in
 * SLACK_BOT_TOKEN (env var, set in the deployment environment) rather than
 * SystemConfig, unlike the Unipile notification-mailbox setting below it in
 * system-settings.routes.ts. Rotating it is an engineering/deploy action.
 */
async function postMessage(payload: Record<string, unknown>): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.warn("[slack] Slack bot token not configured -- skipping Slack notification");
    return;
  }

  const response = await axios.post("https://slack.com/api/chat.postMessage", payload, {
    headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
  });

  if (!response.data.ok) {
    // Slack's API returns 200 with {ok: false, error: "..."} on failure
    // (e.g. an invalid/stale member id) rather than an HTTP error status.
    console.error(`[slack] chat.postMessage failed: ${response.data.error}`);
  }
}

/** A plain-text DM -- kept for any caller that hasn't built a SlackCard. */
export async function sendSlackDm(slackMemberId: string, text: string): Promise<void> {
  await postMessage({ channel: slackMemberId, text });
}

/**
 * A formatted notification card: a colored accent bar (Block Kit itself has
 * no color property -- that bar only exists on a legacy `attachments` entry,
 * which still fully supports nesting today's Block Kit `blocks` inside it)
 * containing an emoji headline, a bold label/value field list, an optional
 * note, and an optional link-out button. `fallbackText` is required by
 * Slack for notification previews/screen readers when the real content is
 * blocks, not `text`.
 */
export async function sendSlackCard(
  slackMemberId: string,
  color: string,
  blocks: unknown[],
  fallbackText: string
): Promise<void> {
  await postMessage({ channel: slackMemberId, text: fallbackText, attachments: [{ color, blocks }] });
}
