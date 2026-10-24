'use strict';

const nodemailer = require('nodemailer');

/**
 * Outbound email.
 *
 * Lives in `@ibitplay/common` because more than one service sends mail — OTPs
 * and account notices from user-service, deposit and withdrawal alerts from
 * admin-service — and a second copy of "how do we talk to SMTP" is a second
 * place for credentials to end up hard-coded.
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────
 * `legacy/index.js:3996` built a transport inline, per request, with the
 * credentials in the source:
 *
 *     const transporter = nodemailer.createTransport({
 *       host: 'smtpout.secureserver.net', port: 465, secure: true,
 *       auth: { user: 'support@camelbit.games', pass: 'camelbit@123' },
 *     });
 *
 * That password is in the repository history and must be rotated. A new TCP
 * connection and TLS handshake per email is also why the endpoint was slow
 * enough to be worth a denial-of-service on its own; the transport is pooled
 * here.
 *
 * ── AN UNCONFIGURED MAILER DOES NOT SEND ─────────────────────────────────
 * It reports failure rather than throwing, and logs at `warn`. A missing SMTP
 * configuration must not take down a registration flow — but it must also never
 * look like a successful send, because "the OTP was sent" is what the caller
 * tells the player.
 */
class Mailer {
  /**
   * @param {object} opts
   * @param {object} opts.config  Needs SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM.
   * @param {object} [opts.logger]
   * @param {object} [opts.transport] Injected in tests — anything with `sendMail`.
   */
  constructor({ config = {}, logger, transport } = {}) {
    this.config = config;
    this.logger = logger;
    this.injected = transport;
    this.transport = null;
  }

  get configured() {
    return Boolean(this.injected || (this.config.SMTP_HOST && this.config.SMTP_USER && this.config.SMTP_PASSWORD));
  }

  /** Built once and reused. nodemailer pools the connections. */
  #resolve() {
    if (this.injected) return this.injected;
    if (this.transport) return this.transport;

    this.transport = nodemailer.createTransport({
      host: this.config.SMTP_HOST,
      port: Number(this.config.SMTP_PORT ?? 465),
      secure: Number(this.config.SMTP_PORT ?? 465) === 465,
      auth: { user: this.config.SMTP_USER, pass: this.config.SMTP_PASSWORD },
      pool: true,
      maxConnections: Number(this.config.SMTP_MAX_CONNECTIONS ?? 5),
    });

    return this.transport;
  }

  /**
   * Send one message.
   *
   * Resolves `{sent: boolean, id?, error?}` and never rejects. A caller on a
   * registration or password-reset path must be able to decide what to tell the
   * player, and an exception thrown from inside a transaction would roll back
   * work that has nothing to do with the mail.
   */
  async send({ to, subject, html, text, from }) {
    if (!this.configured) {
      this.logger?.warn({ to: redact(to), subject }, 'SMTP is not configured — email NOT sent');
      return { sent: false, error: 'SMTP is not configured' };
    }

    try {
      const info = await this.#resolve().sendMail({
        from: from || this.config.MAIL_FROM || this.config.SMTP_USER,
        to,
        subject,
        html,
        text,
      });

      this.logger?.info({ to: redact(to), subject, messageId: info?.messageId }, 'Email sent');
      return { sent: true, id: info?.messageId ?? null };
    } catch (error) {
      this.logger?.error({ err: error, to: redact(to), subject }, 'Email send failed');
      return { sent: false, error: error.message };
    }
  }

  /**
   * Send the same message to many recipients, one at a time.
   *
   * Sequential on purpose. A bulk send is the one place where fanning out is
   * tempting and wrong: providers rate-limit per connection, and a burst is
   * what gets a sending domain marked as spam. Returns a per-recipient result
   * so a partial failure is visible rather than averaged away.
   */
  async sendBulk(recipients, message) {
    const results = [];

    for (const to of recipients) {
      // eslint-disable-next-line no-await-in-loop
      results.push({ to, ...(await this.send({ ...message, to })) });
    }

    return {
      sent: results.filter((r) => r.sent).length,
      failed: results.filter((r) => !r.sent).length,
      results,
    };
  }
}

/** `alice@example.com` → `a***e@example.com`. Logs should not carry addresses. */
function redact(address) {
  const value = String(address ?? '');
  const at = value.indexOf('@');
  if (at < 1) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length <= 2) return `***${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain}`;
}

module.exports = { Mailer, redact };
