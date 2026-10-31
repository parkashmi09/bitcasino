'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sendSuccessEmail } = require('../successEmail');

const deps = ({ email = 'p@example.com', prefs = null, configured = true } = {}) => {
  const sent = [];
  return {
    sent,
    config: { PUBLIC_SITE_URL: 'https://site.example/' },
    mailer: { configured, send: async (m) => (sent.push(m), { sent: true }) },
    models: {
      Users: { findByPk: async () => ({ email, name: 'Ravi <b>' }) },
      Userconfig: { findOne: async () => prefs },
    },
  };
};

test('a deposit success email goes out by default, escaped, with the site link', async () => {
  const d = deps();
  const out = await sendSuccessEmail(d, 7, { kind: 'deposit_approved' }, '500.00 INR');
  assert.equal(out.sent, true);
  assert.equal(d.sent[0].to, 'p@example.com');
  assert.equal(d.sent[0].subject, 'Deposit successful');
  assert.match(d.sent[0].html, /500\.00 INR has been added to your wallet/);
  assert.match(d.sent[0].html, /Ravi &lt;b&gt;/);
  assert.match(d.sent[0].html, /https:\/\/site\.example\/wallet\/transaction/);
});

test('switched off, no address, no SMTP or another kind: nothing is sent', async () => {
  for (const [d, n, skipped] of [
    [deps({ prefs: { withdraw_email: false } }), { kind: 'withdrawal_paid' }, 'OPTED_OUT'],
    [deps({ email: null }), { kind: 'deposit_credited' }, 'NO_EMAIL'],
    [deps({ configured: false }), { kind: 'deposit_approved' }, 'NOT_APPLICABLE'],
    [deps(), { kind: 'deposit_rejected' }, 'NOT_APPLICABLE'],
  ]) {
    const out = await sendSuccessEmail(d, 7, n, '1 INR');
    assert.equal(out.sent, false);
    assert.equal(out.skipped, skipped);
    assert.equal(d.sent.length, 0);
  }
});
