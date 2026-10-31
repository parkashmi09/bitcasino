'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { SiteMailer } = require('../siteMailer');

/** Records the config each mailer is built with; "configured" like the real one. */
class FakeMailer {
  constructor({ config }) {
    this.config = config;
  }

  get configured() {
    return Boolean(this.config.SMTP_HOST && this.config.SMTP_USER && this.config.SMTP_PASSWORD);
  }

  async send() {
    return this.configured ? { sent: true, via: this.config } : { sent: false, error: 'SMTP is not configured' };
  }

  async sendBulk() {
    return [];
  }
}

const build = (config, sender) => {
  let calls = 0;
  const m = new SiteMailer({ config, MailerClass: FakeMailer, clients: { admin: { get: async () => (calls++, sender) } } });
  return { m, calls: () => calls };
};

test('no .env account: the panel sender, on Gmail by default, From = that account, cached', async () => {
  const { m, calls } = build({}, { sendFrom: 'sender@gmail.com', appPassword: 'abcd' });
  const a = await m.send({});
  await m.send({});
  assert.equal(a.sent, true);
  assert.deepEqual([a.via.SMTP_HOST, a.via.SMTP_USER, a.via.SMTP_PASSWORD, a.via.MAIL_FROM], ['smtp.gmail.com', 'sender@gmail.com', 'abcd', 'sender@gmail.com']);
  assert.equal(calls(), 1);
});

test('a complete .env account wins and the panel is not asked', async () => {
  const { m, calls } = build({ SMTP_HOST: 'h', SMTP_USER: 'env@x', SMTP_PASSWORD: 'p' }, { sendFrom: 'sender@gmail.com', appPassword: 'abcd' });
  const out = await m.send({});
  assert.equal(out.via.SMTP_USER, 'env@x');
  assert.equal(calls(), 0);
});

test('nothing in .env or the panel: not sent, never throws', async () => {
  const { m } = build({}, null);
  const out = await m.send({});
  assert.deepEqual(out, { sent: false, error: 'SMTP is not configured' });
});
