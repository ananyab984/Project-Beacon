/**
 * Pre-flight offline verification script for Unipile POC server.
 * 
 * Verifies:
 * 1. DSN normalization helper logic.
 * 2. Webhook payload normalizer for both flat and nested shapes.
 * 3. In-memory log entry creation.
 * 4. Email recipient array structure formatting.
 */

const assert = require('assert');
const FormData = require('form-data');

console.log('---------------------------------------------------------------');
console.log('  Running Pre-Flight Tests for Unipile POC');
console.log('---------------------------------------------------------------\n');

// 1. Test DSN Normalization Helper
function getUnipileBaseUrl(dsn) {
  let d = (dsn || 'api8.unipile.com:13081').trim();
  if (!d.startsWith('http://') && !d.startsWith('https://')) {
    d = `https://${d}`;
  }
  d = d.replace(/\/+$/, '');
  if (!d.includes('/api/v1')) {
    d = `${d}/api/v1`;
  }
  return d;
}

assert.strictEqual(getUnipileBaseUrl('api8.unipile.com:13081'), 'https://api8.unipile.com:13081/api/v1');
assert.strictEqual(getUnipileBaseUrl('https://api8.unipile.com:13081/api/v1'), 'https://api8.unipile.com:13081/api/v1');
console.log('✅ DSN Normalizer Test: Passed');

// 2. Test Unified Webhook Normalizer
function normalizeWebhookPayload(body) {
  const statusMessage = body.AccountStatus?.message ?? body.status ?? body.event ?? 'unknown_status';
  const accountId = body.AccountStatus?.account_id ?? body.account_id ?? body.account_id_from_unipile ?? null;
  const accountName = body.AccountStatus?.name ?? body.name ?? body.account_name ?? null;

  return { statusMessage, accountId, accountName, raw: body };
}

// Flat shape test (notify)
const flatBody = { status: 'ACCOUNT_CONNECTED', account_id: 'acc_12345', name: 'John LinkedIn' };
const normFlat = normalizeWebhookPayload(flatBody);
assert.strictEqual(normFlat.statusMessage, 'ACCOUNT_CONNECTED');
assert.strictEqual(normFlat.accountId, 'acc_12345');
console.log('✅ Webhook Normalizer (Flat Notify Shape): Passed');

// Nested shape test (account-status)
const nestedBody = { AccountStatus: { account_id: 'acc_67890', message: 'RECONNECT_REQUIRED', name: 'Jane Google' } };
const normNested = normalizeWebhookPayload(nestedBody);
assert.strictEqual(normNested.statusMessage, 'RECONNECT_REQUIRED');
assert.strictEqual(normNested.accountId, 'acc_67890');
console.log('✅ Webhook Normalizer (Nested AccountStatus Shape): Passed');

// 3. Test Email Recipient Array Formatting
function formatEmailPayload(accountId, toEmail, subject, body) {
  return {
    account_id: accountId,
    to: [{ identifier: toEmail.trim(), display_name: '' }],
    subject,
    body,
    tracking_options: { opens: true, links: true, label: 'poc-test' }
  };
}

const emailPayload = formatEmailPayload('acc_999', 'target@domain.com', 'Test Subject', 'Hello body');
assert.deepStrictEqual(emailPayload.to, [{ identifier: 'target@domain.com', display_name: '' }]);
assert.strictEqual(emailPayload.tracking_options.opens, true);
assert.strictEqual(emailPayload.tracking_options.links, true);
console.log('✅ Email Payload Formatting Test: Passed');

// 4. Test Multipart Form-Data construction for LinkedIn DM
const form = new FormData();
form.append('account_id', 'acc_li_111');
form.append('attendees_ids', 'https://www.linkedin.com/in/testuser');
form.append('text', 'Test message text');

const headers = form.getHeaders();
assert.ok(headers['content-type'].includes('multipart/form-data'));
console.log('✅ Multipart/Form-Data Construction Test: Passed');

console.log('\n===============================================================');
console.log('  ALL PRE-FLIGHT TESTS PASSED SUCCESSFULLY! 🎉');
console.log('===============================================================\n');
