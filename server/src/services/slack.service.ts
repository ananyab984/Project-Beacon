import axios from "axios";
import { getSystemSetting } from "./system-settings.service";

/**
 * Sends a direct message via G3's one company-wide Slack bot. Uses axios
 * directly against Slack's Web API (chat.postMessage) rather than pulling in
 * the @slack/web-api SDK -- one POST call doesn't earn a new dependency when
 * axios is already used everywhere else in this service layer. Silently
 * no-ops if the bot isn't configured yet, or if this particular recruiter
 * hasn't pasted their Slack member id -- matches the spec: "nothing breaks."
 *
 * The bot token is owner-configurable in-app (see system-settings.routes.ts)
 * rather than an env-var-only value, so G3 can rotate/set it themselves.
 */
export async function sendSlackDm(slackMemberId: string, text: string): Promise<void> {
  const botToken = await getSystemSetting("SLACK_BOT_TOKEN");
  if (!botToken) {
    console.warn("[slack] Slack bot token not configured -- skipping Slack notification");
    return;
  }

  const response = await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel: slackMemberId, text },
    { headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" } }
  );

  if (!response.data.ok) {
    // Slack's API returns 200 with {ok: false, error: "..."} on failure
    // (e.g. an invalid/stale member id) rather than an HTTP error status.
    console.error(`[slack] chat.postMessage failed: ${response.data.error}`);
  }
}
