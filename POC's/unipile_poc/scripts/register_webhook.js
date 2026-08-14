/**
 * One-time webhook registration script for Unipile POC
 *
 * Registers two webhooks with the Unipile API:
 * - source: "account_status"  -> <APP_BASE_URL>/api/webhook/account-status
 * - source: "email_tracking"  -> <APP_BASE_URL>/api/webhook/email-tracking
 * Both include header: X-G3-Webhook-Secret: <UNIPILE_WEBHOOK_SECRET>
 *
 * Usage:
 *   node scripts/register_webhook.js
 */

const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

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

async function registerWebhook() {
  const apiKey = (process.env.UNIPILE_API_KEY || '').trim();
  const webhookSecret = (process.env.UNIPILE_WEBHOOK_SECRET || 'secret_g3_webhook_key_2026').trim();
  const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const unipileBaseUrl = getUnipileBaseUrl();

  if (!apiKey || apiKey === 'your_unipile_api_key_here') {
    console.error('\n❌ ERROR: UNIPILE_API_KEY is not configured in .env file.');
    console.error('Please update .env with your real Unipile API Key before registering webhooks.\n');
    process.exit(1);
  }

  if (appBaseUrl.includes('localhost') || appBaseUrl.includes('127.0.0.1')) {
    console.warn('\n⚠️  WARNING: APP_BASE_URL is currently set to: ' + appBaseUrl);
    console.warn('Unipile servers CANNOT reach localhost or 127.0.0.1 directly!');
    console.warn('Webhooks registered pointing to localhost will silently fail.');
    console.warn('\nTo fix this for local dev:');
    console.warn('  1. Start ngrok tunnel:  ngrok http 3000');
    console.warn('  2. Copy the https://xxxx.ngrok-free.app URL');
    console.warn('  3. Update .env:         APP_BASE_URL=https://xxxx.ngrok-free.app');
    console.warn('  4. Re-run this script:   npm run register-webhook\n');
  }

  console.log('\n===============================================================');
  console.log('  Registering Unipile Webhooks');
  console.log('===============================================================');

  const authHeaders = {
    'X-API-KEY': apiKey,
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // Check existing webhooks to avoid duplicates
  let existing = [];
  try {
    const listRes = await axios.get(`${unipileBaseUrl}/webhooks`, { headers: authHeaders });
    existing = listRes.data.items || listRes.data || [];
    console.log(`Found ${existing.length} existing webhook(s) registered on Unipile.`);
    for (const w of existing) {
      console.log(`  - ID: ${w.id} | Source: ${w.source} | URL: ${w.request_url}`);
    }
  } catch (err) {
    console.log('Could not list existing webhooks (continuing registration)...');
  }

  const webhooksToRegister = [
    { source: 'account_status', name: 'poc-account-status', path: '/api/webhook/account-status' },
    { source: 'email_tracking', name: 'poc-email-tracking', path: '/api/webhook/email-tracking' },
    { source: 'messaging', name: 'poc-messaging', path: '/api/webhook/messaging' }
  ];

  for (const wh of webhooksToRegister) {
    const requestUrl = `${appBaseUrl}${wh.path}`;
    const alreadyRegistered = existing.some(w => w.source === wh.source && w.request_url === requestUrl);
    if (alreadyRegistered) {
      console.log(`\n⏭️  Skipping "${wh.source}" — already registered for ${requestUrl}`);
      continue;
    }

    console.log(`\nRegistering "${wh.source}" -> ${requestUrl}`);
    const webhookPayload = {
      request_url: requestUrl,
      source: wh.source,
      name: wh.name,
      format: 'json',
      enabled: true,
      headers: [{ key: 'X-G3-Webhook-Secret', value: webhookSecret }]
    };

    try {
      const response = await axios.post(`${unipileBaseUrl}/webhooks`, webhookPayload, { headers: authHeaders });
      console.log(`✅ "${wh.source}" registered successfully!`);
      console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
      const details = error.response ? error.response.data : error.message;
      console.error(`❌ "${wh.source}" registration failed!`);
      console.error('Error Details:', JSON.stringify(details, null, 2));
      process.exit(1);
    }
  }

  console.log('\n===============================================================\n');
}

registerWebhook();

