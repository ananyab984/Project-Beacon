# Unipile Hosted-Auth, Webhook & Test Messaging POC (`unipile_poc`)

A lightweight, single-user Proof of Concept (POC) built in **Node.js + Express** with an **in-memory event store** and a **plain HTML/JS single-page dashboard** to validate Unipile's integration capabilities.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            UNIPILE INTEGRATION POC                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Hosted-Auth Link   ──▶  Unipile Hosted Wizard  ──▶  Redirect Callback    │
│  2. Webhooks          ──▶  /api/webhook/*       ──▶  Unified Normalizer     │
│  3. LinkedIn Message  ──▶  POST /api/v1/chats   ──▶  multipart/form-data    │
│  4. Tracked Email     ──▶  POST /api/v1/emails  ──▶  opens & links: true    │
│  5. Live Activity Log ──▶  Polling /api/activity──▶  Raw Expandable JSON    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Features

- **Hosted Authentication (`POST /api/connect`)**: Generates single-use Unipile hosted links for **LinkedIn** and **Google/Email** with callback redirect URLs (`type: "create"`, `providers: [...]`).
- **Webhook Status Receivers (`/api/webhook/notify` & `/api/webhook/account-status`)**: Receives both flat and nested webhook payloads, validates custom `X-G3-Webhook-Secret` header, normalizes status messages, and responds `200 OK` instantly.
- **LinkedIn DM Sender (`POST /api/actions/linkedin-message`)**: Constructs `multipart/form-data` requests (`account_id`, `attendees_ids`, `text`) to `POST /api/v1/chats`. *(Backend route only — not currently wired into the dashboard UI; call it directly via curl/Postman.)*
- **Tracked Email Sender (`POST /api/actions/email`)**: Constructs `application/json` requests with recipient objects `to: [{ identifier: "email@example.com", display_name: "" }]` and `tracking_options: { opens: true, links: true, label: "poc-test" }`.
- **Live Activity Log UI**: Polling dashboard that refreshes every 3 seconds, rendering timestamped event logs with expandable raw JSON.

---

## Quick Start

### 1. Installation

```bash
cd unipile_poc
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Update `.env` with your real Unipile credentials:

```env
UNIPILE_DSN="api8.unipile.com:13081"
UNIPILE_API_KEY="<your_unipile_api_key>"
UNIPILE_WEBHOOK_SECRET="secret_g3_webhook_key_2026"
APP_BASE_URL="https://xxxx.ngrok-free.app"
PORT=3000
```

> [!IMPORTANT]
> For live webhook reception from Unipile, set up a public tunnel (e.g., `ngrok http 3000`) and set `APP_BASE_URL` to your ngrok URL.

### 3. Run Pre-Flight Tests

Verify route logic, DSN helper, normalizer, and multipart payload builders offline:

```bash
npm run test-preflight
```

### 4. Register Account-Status Webhook (One-Time Setup)

Register the webhook endpoint with Unipile API:

```bash
npm run register-webhook
```

Expected output: `✅ Webhook Registered Successfully!`

### 5. Start the POC Server

```bash
npm start
```

Open `http://localhost:3000` in your browser.

---

## End-to-End Testing Workflow

1. **Hosted Auth Connect**:
   - Click **Connect Google Account** or **Connect via IMAP / App Password**.
   - The browser redirects to Unipile's hosted wizard. Complete authentication.
   - Upon completion, Unipile redirects back to `/connected.html?status=ok`.
2. **Webhook Verification**:
   - Check the **Live Activity Log** on the dashboard. You will see `webhook_notify` or `webhook_account_status` events appear in real-time.
3. **Send Tracked Email**:
   - Select your connected Email account from the dropdown.
   - Enter recipient email address, subject, and body.
   - Click **Send Tracked Email**. Open and click the email links on the receiving client to watch open/link tracking events log live in the activity feed.

---

## API Summary

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/connect` | Generates Unipile hosted auth URL for LinkedIn/Google |
| `POST` | `/api/webhook/notify` | Webhook receiver for notify events (`X-G3-Webhook-Secret`) |
| `POST` | `/api/webhook/account-status` | Webhook receiver for account status (`X-G3-Webhook-Secret`) |
| `GET` | `/api/accounts` | Lists connected accounts from Unipile API |
| `POST` | `/api/actions/linkedin-message` | Sends LinkedIn DM via `multipart/form-data` to `POST /api/v1/chats` |
| `POST` | `/api/actions/email` | Sends Tracked Email via `application/json` to `POST /api/v1/emails` |
| `GET` | `/api/activity` | Returns in-memory activity log events |
| `DELETE`| `/api/activity` | Clears in-memory activity log |
