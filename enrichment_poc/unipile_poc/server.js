const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store for activity log
const activityLog = [];

// In-memory store for sent emails, keyed by tracking_id, for open/click tracking
const sentEmails = [];

/**
 * Helper to get normalized Unipile Base API URL
 */
function getUnipileBaseUrl() {
  let dsn = (process.env.UNIPILE_DSN || 'api8.unipile.com:13081').trim();
  if (!dsn.startsWith('http://') && !dsn.startsWith('https://')) {
    dsn = `https://${dsn}`;
  }
  dsn = dsn.replace(/\/+$/, '');
  if (!dsn.includes('/api/v1')) {
    dsn = `${dsn}/api/v1`;
  }
  return dsn;
}

/**
 * Helper for Unipile API headers
 */
function getUnipileHeaders(extraHeaders = {}) {
  const apiKey = (process.env.UNIPILE_API_KEY || '').trim();
  return {
    'X-API-KEY': apiKey,
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json',
    ...extraHeaders
  };
}

/**
 * Add event to in-memory activity log
 */
function logEvent(type, summary, payload, accountId = null) {
  const event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    type,
    summary,
    accountId,
    payload
  };
  activityLog.unshift(event);
  console.log(`[${event.timestamp}] [${type.toUpperCase()}] ${summary}`);
  return event;
}

/**
 * Verifies the X-G3-Webhook-Secret header against UNIPILE_WEBHOOK_SECRET.
 * Rejects the request with 401 on mismatch. No-ops (allows) if no secret is configured.
 */
function verifyWebhookSecret(req, res) {
  const expectedSecret = process.env.UNIPILE_WEBHOOK_SECRET;
  if (!expectedSecret) return true;

  const secretHeader = req.headers['x-g3-webhook-secret'];
  if (secretHeader !== expectedSecret) {
    console.warn(`[Webhook Secret Mismatch] ${req.path}: got "${secretHeader || ''}"`);
    res.status(401).json({ error: 'Invalid webhook secret' });
    return false;
  }
  return true;
}

/**
 * Unified Webhook Normalizer
 * Reads body.AccountStatus?.message ?? body.status ?? body.event
 */
function normalizeWebhookPayload(body) {
  const statusMessage = body.AccountStatus?.message ?? body.status ?? body.event ?? 'unknown_status';
  const accountId = body.AccountStatus?.account_id ?? body.account_id ?? body.account_id_from_unipile ?? null;
  const accountName = body.AccountStatus?.name ?? body.name ?? body.account_name ?? null;

  return {
    statusMessage,
    accountId,
    accountName,
    raw: body
  };
}

// --------------------------------------------------------------------------- //
// 1. Hosted Auth Connect Endpoint
// --------------------------------------------------------------------------- //

function getUnipileHostUrl() {
  let dsn = (process.env.UNIPILE_DSN || 'api25.unipile.com:15598').trim();
  if (!dsn.startsWith('http://') && !dsn.startsWith('https://')) {
    dsn = `https://${dsn}`;
  }
  dsn = dsn.replace(/\/+$/, '');
  dsn = dsn.replace(/\/api\/v1\/?$/, '');
  return dsn;
}

app.post('/api/connect', async (req, res) => {
  const { provider } = req.body;
  const pUpper = (provider || '').toUpperCase();
  const validProviders = ['LINKEDIN', 'GOOGLE', 'MAIL', 'OUTLOOK', 'EMAIL'];
  if (!pUpper || !validProviders.includes(pUpper)) {
    return res.status(400).json({ error: `provider must be one of: ${validProviders.join(', ')}` });
  }

  const appBaseUrl = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
  const unipileBaseUrl = getUnipileBaseUrl();
  const unipileHostUrl = getUnipileHostUrl();

  let targetProviders = [pUpper];
  let bypassSuccess = true;

  if (pUpper === 'EMAIL') {
    targetProviders = ['MAIL', 'GOOGLE', 'OUTLOOK'];
    bypassSuccess = false;
  }

  const payload = {
    type: 'create',
    providers: targetProviders,
    api_url: unipileHostUrl,
    expiresOn: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    name: `connect_${pUpper.toLowerCase()}_${Date.now()}`,
    notify_url: `${appBaseUrl}/api/webhook/notify`,
    success_redirect_url: `${appBaseUrl}/connected.html?status=ok&provider=${pUpper}`,
    failure_redirect_url: `${appBaseUrl}/connected.html?status=failed&provider=${pUpper}`,
    bypass_success_screen: bypassSuccess,
    single_use: true
  };

  try {
    const targetUrl = `${unipileBaseUrl}/hosted/accounts/link`;
    console.log(`Requesting Unipile Hosted Link: POST ${targetUrl}`);
    const response = await axios.post(targetUrl, payload, {
      headers: getUnipileHeaders({ 'Content-Type': 'application/json' })
    });

    const redirectUrl = response.data.url;
    logEvent(
      'action_connect',
      `Generated Hosted Auth Link for ${pUpper}`,
      { request: payload, response: response.data }
    );

    return res.json({ success: true, url: redirectUrl });
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error('Unipile Hosted Link generation failed:', errorDetails);
    logEvent(
      'action_connect_error',
      `Failed to generate Hosted Link for ${pUpper}`,
      { error: errorDetails }
    );
    return res.status(500).json({ error: 'Failed to generate hosted link', details: errorDetails });
  }
});

// --------------------------------------------------------------------------- //
// 2. Webhook Receiver Routes
// --------------------------------------------------------------------------- //

app.post('/api/webhook/notify', (req, res) => {
  if (!verifyWebhookSecret(req, res)) return;

  const normalized = normalizeWebhookPayload(req.body);
  logEvent(
    'webhook_notify',
    `Notify Webhook: ${normalized.statusMessage} (Account: ${normalized.accountId || 'N/A'})`,
    normalized.raw,
    normalized.accountId
  );

  // Respond 200 OK fast
  return res.status(200).json({ status: 'ok' });
});

app.post('/api/webhook/account-status', (req, res) => {
  if (!verifyWebhookSecret(req, res)) return;

  const normalized = normalizeWebhookPayload(req.body);
  logEvent(
    'webhook_account_status',
    `Account-Status Webhook: ${normalized.statusMessage} (Account: ${normalized.accountId || 'N/A'})`,
    normalized.raw,
    normalized.accountId
  );

  // Respond 200 OK fast
  return res.status(200).json({ status: 'ok' });
});

// POST /api/webhook/email-tracking — Receives mail_opened / mail_link_clicked events
app.post('/api/webhook/email-tracking', (req, res) => {
  if (!verifyWebhookSecret(req, res)) return;

  const { event, tracking_id, date } = req.body;
  const record = sentEmails.find(e => e.tracking_id === tracking_id);

  if (record) {
    if (event === 'mail_opened' && !record.openedAt) {
      record.status = 'opened';
      record.openedAt = date || new Date().toISOString();
    } else if (event === 'mail_link_clicked') {
      record.status = 'clicked';
      record.clickedAt = date || new Date().toISOString();
    }
  }

  logEvent(
    'webhook_email_tracking',
    `Email Tracking: ${event || 'unknown_event'} for recipient ${record ? record.to_email : tracking_id}`,
    req.body,
    record ? record.account_id : null
  );

  return res.status(200).json({ status: 'ok' });
});

// POST /api/webhook/messaging — Receives real-time chat messages / read receipts / replies
app.post('/api/webhook/messaging', (req, res) => {
  if (!verifyWebhookSecret(req, res)) return;

  const { event, account_id, sender_name, message, chat_id } = req.body;
  logEvent(
    'webhook_messaging',
    `Messaging Event: ${event || 'message_received'} (${sender_name || 'Lead'})`,
    req.body,
    account_id
  );

  return res.status(200).json({ status: 'ok' });
});

// --------------------------------------------------------------------------- //
// 3. Test Actions & Connected Accounts
// --------------------------------------------------------------------------- //

// GET /api/accounts — Proxy to list connected Unipile accounts for testing dropdowns
app.get('/api/accounts', async (req, res) => {
  try {
    const unipileBaseUrl = getUnipileBaseUrl();
    const response = await axios.get(`${unipileBaseUrl}/accounts`, {
      headers: getUnipileHeaders()
    });
    return res.json(response.data);
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error('Failed to fetch Unipile accounts:', errorDetails);
    return res.status(500).json({ error: 'Failed to fetch accounts', details: errorDetails });
  }
});

// DELETE /api/accounts/:account_id — Delete/disconnect account from Unipile
app.delete('/api/accounts/:account_id', async (req, res) => {
  const { account_id } = req.params;
  try {
    const unipileBaseUrl = getUnipileBaseUrl();
    const response = await axios.delete(`${unipileBaseUrl}/accounts/${account_id}`, {
      headers: getUnipileHeaders()
    });

    logEvent(
      'action_account_delete',
      `Deleted Unipile Account ${account_id}`,
      { response: response.data },
      account_id
    );

    return res.json({ success: true, data: response.data });
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error(`Failed to delete Unipile account ${account_id}:`, errorDetails);
    logEvent(
      'action_account_delete_error',
      `Failed to delete Unipile Account ${account_id}`,
      { error: errorDetails },
      account_id
    );
    return res.status(500).json({ error: 'Failed to delete account', details: errorDetails });
  }
});

// GET /api/chats — Fetch active 1-on-1 conversations/chats from Unipile API
app.get('/api/chats', async (req, res) => {
  const { account_id } = req.query;
  try {
    const unipileBaseUrl = getUnipileBaseUrl();
    const targetUrl = account_id ? `${unipileBaseUrl}/chats?account_id=${account_id}` : `${unipileBaseUrl}/chats`;
    const response = await axios.get(targetUrl, { headers: getUnipileHeaders() });
    return res.json(response.data);
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error('Failed to fetch chats:', errorDetails);
    return res.status(500).json({ error: 'Failed to fetch chats', details: errorDetails });
  }
});

// GET /api/chats/:chat_id/messages — Fetch full message thread history for a conversation
app.get('/api/chats/:chat_id/messages', async (req, res) => {
  const { chat_id } = req.params;
  try {
    const unipileBaseUrl = getUnipileBaseUrl();
    const response = await axios.get(`${unipileBaseUrl}/chats/${chat_id}/messages`, {
      headers: getUnipileHeaders()
    });
    return res.json(response.data);
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error('Failed to fetch chat messages:', errorDetails);
    return res.status(500).json({ error: 'Failed to fetch chat messages', details: errorDetails });
  }
});

// GET /api/emails — Fetch sent emails & live open/click tracking status from Unipile API + in-memory store
app.get('/api/emails', async (req, res) => {
  let { account_id } = req.query;
  try {
    const unipileBaseUrl = getUnipileBaseUrl();
    const headers = getUnipileHeaders();
    let emailAccountIds = [];

    if (account_id) {
      emailAccountIds.push(account_id);
    } else {
      try {
        const accRes = await axios.get(`${unipileBaseUrl}/accounts`, { headers });
        const items = accRes.data.items || accRes.data || [];
        emailAccountIds = items
          .filter(a => ['GOOGLE_OAUTH', 'MAIL', 'OUTLOOK'].includes((a.type || a.provider || '').toUpperCase()))
          .map(a => a.id);
      } catch (err) {
        console.warn('Could not fetch accounts for email query:', err.message);
      }
    }

    let apiEmails = [];
    for (const accId of emailAccountIds) {
      try {
        const response = await axios.get(`${unipileBaseUrl}/emails?account_id=${accId}`, { headers });
        const items = response.data.items || response.data.emails || (Array.isArray(response.data) ? response.data : []);
        apiEmails.push(...items);
      } catch (err) {
        // Silently skip if no emails for account
      }
    }

    const combined = [...sentEmails];
    for (const item of apiEmails) {
      const recipient = (item.to_attendees && item.to_attendees[0])
        ? (item.to_attendees[0].identifier || item.to_attendees[0].display_name || 'recipient')
        : ((item.to && item.to[0]) ? (item.to[0].identifier || 'recipient') : 'recipient');
      
      const isOpened = Boolean(item.read_date || item.tracking_opened || item.tracking_last_opened_at);
      const isClicked = Boolean(item.tracking_clicked);

      const existing = combined.find(e => e.email_id === item.id || e.tracking_id === item.tracking_id);
      if (!existing) {
        combined.push({
          email_id: item.id,
          account_id: item.account_id,
          to_email: recipient,
          subject: item.subject || 'No Subject',
          sentAt: item.date || item.created_at || new Date().toISOString(),
          status: isClicked ? 'clicked' : (isOpened ? 'opened' : 'sent'),
          openedAt: item.read_date || item.tracking_last_opened_at || (isOpened ? item.date : null),
          clickedAt: isClicked ? item.date : null
        });
      } else {
        if (isOpened) {
          existing.status = isClicked ? 'clicked' : 'opened';
          existing.openedAt = item.read_date || item.tracking_last_opened_at || existing.openedAt;
        }
      }
    }

    return res.json({ emails: combined });
  } catch (error) {
    return res.json({ emails: sentEmails });
  }
});

// POST /api/actions/linkedin-message — Smart LinkedIn outreach (DM for 1st degree, Connection Request + Note for 2nd/3rd degree)
app.post('/api/actions/linkedin-message', async (req, res) => {
  const { account_id, attendee_id, text } = req.body;
  if (!account_id || !attendee_id || !text) {
    return res.status(400).json({ error: 'account_id, attendee_id, and text are required' });
  }

  let cleanIdentifier = (attendee_id || '').trim();
  if (cleanIdentifier.includes('linkedin.com/in/')) {
    const match = cleanIdentifier.match(/linkedin\.com\/in\/([^\/\?#]+)/);
    if (match) cleanIdentifier = match[1];
  }

  const unipileBaseUrl = getUnipileBaseUrl();
  const headers = getUnipileHeaders();

  // Step 1: Profile lookup to resolve exact provider_id and network_distance
  let userProfile = null;
  try {
    const profileRes = await axios.get(`${unipileBaseUrl}/users/${encodeURIComponent(cleanIdentifier)}?account_id=${account_id}`, { headers });
    userProfile = profileRes.data;
  } catch (err) {
    console.warn(`User lookup failed for ${cleanIdentifier}, proceeding with direct attempt:`, err.message);
  }

  const providerId = (userProfile && userProfile.provider_id) ? userProfile.provider_id : cleanIdentifier;

  // Step 2: If lead is 2nd/3rd degree, send Connection Request with custom message note
  if (userProfile && userProfile.network_distance && userProfile.network_distance !== 'FIRST_DEGREE') {
    try {
      console.log(`Sending Connection Request with note to 2nd/3rd degree lead ${providerId}...`);
      const inviteRes = await axios.post(`${unipileBaseUrl}/users/invite`, {
        account_id,
        provider_id: providerId,
        message: text.substring(0, 300) // Max 300 chars for LinkedIn note
      }, {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });

      logEvent(
        'action_linkedin_invite',
        `Sent Connection Request + Note to ${cleanIdentifier}`,
        { request: { account_id, attendee_id, text }, response: inviteRes.data },
        account_id
      );

      return res.json({ success: true, mode: 'connection_invite', data: inviteRes.data });
    } catch (inviteError) {
      const inviteDetails = inviteError.response ? inviteError.response.data : inviteError.message;
      console.warn('Invite failed, proceeding to DM attempt:', inviteDetails);
    }
  }

  // Step 3: Direct Message attempt (for 1st degree or fallback)
  try {
    const form = new FormData();
    form.append('account_id', account_id);
    form.append('attendees_ids', providerId);
    form.append('text', text);

    const formHeaders = getUnipileHeaders(form.getHeaders());
    const response = await axios.post(`${unipileBaseUrl}/chats`, form, { headers: formHeaders });

    logEvent(
      'action_linkedin_msg',
      `Sent LinkedIn DM to ${cleanIdentifier}`,
      { request: { account_id, attendee_id, text }, response: response.data },
      account_id
    );

    return res.json({ success: true, mode: 'direct_message', data: response.data });
  } catch (error) {
    // Fallback: Try Connection Request with note if direct DM fails
    try {
      console.log('DM failed, trying Connection Request with note as fallback...');
      const inviteRes = await axios.post(`${unipileBaseUrl}/users/invite`, {
        account_id,
        provider_id: providerId,
        message: text.substring(0, 300)
      }, {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });

      logEvent(
        'action_linkedin_invite',
        `Sent Connection Request + Note to ${cleanIdentifier} (fallback)`,
        { request: { account_id, attendee_id, text }, response: inviteRes.data },
        account_id
      );

      return res.json({ success: true, mode: 'connection_invite_fallback', data: inviteRes.data });
    } catch (inviteError) {
      const errorDetails = error.response ? error.response.data : error.message;
      console.error('LinkedIn Message & Invite both failed:', errorDetails);
      logEvent(
        'action_linkedin_msg_error',
        `Failed to send LinkedIn DM or Invite to ${attendee_id}`,
        { error: errorDetails },
        account_id
      );
      return res.status(500).json({ error: 'Failed to send message or connection request', details: errorDetails });
    }
  }
});

// POST /api/actions/email — Sends Tracked Email with to as [{ identifier, display_name }]
app.post('/api/actions/email', async (req, res) => {
  const { account_id, to_email, subject, body } = req.body;
  if (!account_id || !to_email || !subject || !body) {
    return res.status(400).json({ error: 'account_id, to_email, subject, and body are required' });
  }

  const payload = {
    account_id,
    to: [
      {
        identifier: to_email.trim(),
        display_name: ''
      }
    ],
    subject,
    body,
    tracking_options: {
      opens: true,
      links: true,
      label: 'poc-test'
    }
  };

  try {
    const unipileBaseUrl = getUnipileBaseUrl();
    const headers = getUnipileHeaders({ 'Content-Type': 'application/json' });
    const response = await axios.post(`${unipileBaseUrl}/emails`, payload, { headers });

    sentEmails.unshift({
      tracking_id: response.data.tracking_id || null,
      account_id,
      to_email,
      subject,
      sentAt: new Date().toISOString(),
      status: 'sent',
      openedAt: null,
      clickedAt: null
    });

    logEvent(
      'action_email',
      `Sent Tracked Email to ${to_email}`,
      { request: payload, response: response.data },
      account_id
    );

    return res.json({ success: true, data: response.data });
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error('Send Email failed:', errorDetails);
    logEvent(
      'action_email_error',
      `Failed to send Tracked Email to ${to_email}`,
      { error: errorDetails },
      account_id
    );
    return res.status(500).json({ error: 'Failed to send Tracked Email', details: errorDetails });
  }
});

// --------------------------------------------------------------------------- //
// 4. Activity Log Endpoints
// --------------------------------------------------------------------------- //

app.get('/api/activity', (req, res) => {
  return res.json({ events: activityLog });
});

app.delete('/api/activity', (req, res) => {
  activityLog.length = 0;
  logEvent('system', 'Activity log cleared', {});
  return res.json({ success: true, message: 'Activity log cleared' });
});

// Catch-all route to serve dashboard
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n===============================================================`);
  console.log(`  Unipile Integration POC Server running at: http://localhost:${PORT}`);
  console.log(`  Target Unipile API: ${getUnipileBaseUrl()}`);
  console.log(`  Configured APP_BASE_URL: ${process.env.APP_BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`===============================================================\n`);
});
