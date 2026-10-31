'use strict';

const { renderGeneral, escape } = require('../email/templates');

/**
 * The "deposit successful" / "withdrawal successful" emails behind Settings → Preferences →
 * Email Notifications. Sent from `notifyPlayer` the first time an event's row is written, so a
 * retried or replayed event does not mail twice. Skipped when the player switched it off
 * (userconfig.deposit_email / withdraw_email, migration 177), has no email address, or SMTP is
 * not configured. Never throws: an email is a courtesy, the money already moved.
 */
const KINDS = Object.freeze({
  deposit_approved: { column: 'deposit_email', subject: 'Deposit successful', verb: 'has been added to your wallet' },
  deposit_credited: { column: 'deposit_email', subject: 'Deposit successful', verb: 'has been added to your wallet' },
  withdrawal_paid: { column: 'withdraw_email', subject: 'Withdrawal successful', verb: 'has been sent to you' },
});

async function sendSuccessEmail(deps, userId, n, amount) {
  const spec = KINDS[n.kind];
  if (!spec || !deps?.mailer?.configured || !deps.models) return { sent: false, skipped: 'NOT_APPLICABLE' };
  try {
    const [user, prefs] = await Promise.all([
      deps.models.Users.findByPk(userId, { attributes: ['email', 'name'], raw: true }),
      deps.models.Userconfig.findOne({ where: { uid: userId }, attributes: [spec.column], raw: true }),
    ]);
    if (!user?.email) return { sent: false, skipped: 'NO_EMAIL' };
    if (prefs && prefs[spec.column] === false) return { sent: false, skipped: 'OPTED_OUT' };

    const site = String(deps.config?.PUBLIC_SITE_URL || '').replace(/\/+$/, '');
    const content = `<p>Hi ${escape(user.name || 'there')},</p><p>${escape(amount)} ${spec.verb}.</p>`;
    const result = await deps.mailer.send({
      to: user.email,
      ...renderGeneral({ subject: spec.subject, title: spec.subject, content, ctaLink: site ? `${site}/wallet/transaction` : null, ctaText: 'View transactions' }),
    });
    return { sent: Boolean(result?.sent) };
  } catch (error) {
    deps.logger?.warn({ err: error?.message, userId: String(userId), kind: n.kind }, 'Success email not sent — the action itself is unaffected');
    return { sent: false, error: error?.message ?? 'ERROR' };
  }
}

module.exports = { sendSuccessEmail, SUCCESS_EMAIL_KINDS: KINDS };
