'use strict';

const { Mailer } = require('@ibitplay/common');

/**
 * The player-email sender: the .env SMTP account when it is complete, else the Gmail sender and
 * app password staff saved in site admin → Site Config → Email (read from admin-service, cached
 * a minute), so an operator sets the mailbox in the panel without touching the server.
 * SMTP_HOST defaults to Gmail there, the provider that page is for. Same `configured` /
 * `send` / `sendBulk` surface as Mailer; `send` never throws.
 */
const INTERNAL_PATH = '/internal/admin/site-config/mail-sender';
const TTL_MS = 60_000;

class SiteMailer {
  /** `MailerClass` is for tests. */
  constructor({ config = {}, logger, clients, MailerClass = Mailer }) {
    this.MailerClass = MailerClass;
    this.config = config;
    this.logger = logger;
    this.clients = clients;
    this.env = new MailerClass({ config, logger });
    this.cache = { at: 0, key: null, mailer: null };
  }

  /** True when the .env account is complete, or the panel's sender may supply one. */
  get configured() {
    return this.env.configured || Boolean(this.clients?.admin);
  }

  async #mailer() {
    if (this.env.configured) return this.env;
    if (Date.now() - this.cache.at < TTL_MS) return this.cache.mailer ?? this.env;
    let sender = null;
    try {
      sender = await this.clients.admin.get(INTERNAL_PATH);
    } catch (error) {
      this.logger?.warn({ err: error?.message }, 'Could not read the panel mail sender');
    }
    const key = sender ? `${sender.sendFrom}|${sender.appPassword}` : null;
    if (key !== this.cache.key) {
      this.cache.mailer = sender
        ? new this.MailerClass({
            config: {
              ...this.config,
              SMTP_HOST: this.config.SMTP_HOST || 'smtp.gmail.com',
              SMTP_USER: sender.sendFrom,
              SMTP_PASSWORD: sender.appPassword,
              // Gmail rewrites any other From to the account, so name the account itself.
              MAIL_FROM: String(this.config.MAIL_FROM || '').includes(sender.sendFrom) ? this.config.MAIL_FROM : sender.sendFrom,
            },
            logger: this.logger,
          })
        : null;
      this.cache.key = key;
    }
    this.cache.at = Date.now();
    return this.cache.mailer ?? this.env;
  }

  async send(message) {
    return (await this.#mailer()).send(message);
  }

  async sendBulk(recipients, message) {
    return (await this.#mailer()).sendBulk(recipients, message);
  }
}

module.exports = { SiteMailer };
