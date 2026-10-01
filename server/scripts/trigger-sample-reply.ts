/**
 * Helper script to trigger sample inbound webhook replies locally.
 *
 * Usage:
 *   cd server && npx ts-node scripts/trigger-sample-reply.ts linkedin
 *   cd server && npx ts-node scripts/trigger-sample-reply.ts email
 */

import axios from "axios";
import { config } from "../src/config";
import { prisma } from "../src/prisma";

async function main() {
  const channelType = (process.argv[2] || "linkedin").toLowerCase();
  const token = config.unipileWebhookPathToken;
  const secret = config.unipileWebhookSecret;
  const targetUrl = `http://localhost:${config.port}/api/unipile/webhook/${token}`;

  console.log(`\n🚀 Triggering sample ${channelType.toUpperCase()} inbound reply...`);
  console.log(`Target endpoint: ${targetUrl}`);

  // Find a connected account
  const connectedAcc = await prisma.connectedAccount.findFirst({
    where: { status: "OK" },
    include: { user: true },
  });

  const accountId = connectedAcc?.unipileAccountId || "test_account_local_01";
  console.log(`Using Unipile Account ID: ${accountId} (User: ${connectedAcc?.user?.name || "Sample"})`);

  const msgId = `msg_sim_${Date.now()}`;
  let payload: any = {};

  if (channelType === "email") {
    payload = {
      event: "email.received",
      account_id: accountId,
      message_id: msgId,
      body: `Hi, thank you for reaching out! I would love to discuss this opportunity further.\n\nSimulated at: ${new Date().toLocaleTimeString()}`,
      from: { identifier: "candidate@example.com", display_name: "Candidate (via Email)" },
      timestamp: new Date().toISOString(),
    };
  } else {
    payload = {
      event: "message_received",
      account_id: accountId,
      message_id: msgId,
      message: `Hi there! I saw your message on LinkedIn and I'm very interested in working together. Let me know the next steps!\n\n(Sent at ${new Date().toLocaleTimeString()})`,
      sender: { display_name: "Candidate (LinkedIn)" },
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const res = await axios.post(targetUrl, payload, {
      headers: {
        "X-G3-Webhook-Secret": secret,
        "Content-Type": "application/json",
      },
    });

    console.log("\n✅ Webhook response:", res.status, res.data);
    console.log(`\n✨ Successfully injected ${channelType.toUpperCase()} message!`);
    console.log(
      channelType === "email"
        ? "👉 Check the Email Queue page under 'Received Replies' below the sent draft."
        : "👉 Check the LinkedIn Conversations page — the message will appear in the chat thread!"
    );
  } catch (err: any) {
    console.error("❌ Failed to trigger webhook:", err?.response?.status, err?.response?.data || err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
