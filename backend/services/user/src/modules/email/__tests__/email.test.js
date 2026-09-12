'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, Mailer } = require('@ibitplay/common');

const { EmailService } = require('../email.service');
const { renderOtp, renderGeneral, safeUrl } = require('../templates');
const { OTP_RESEND_COOLDOWN_SECONDS, OTP_MAX_ATTEMPTS } = require('../email.constants');

/**
 * One-time codes and operator email.
 *
 * The first test is the whole reason this module exists: legacy handed the code
 * back to whoever asked for it.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 930_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
const addressFor = (uid) => `otp-${uid}@test.local`;

test('email and one-time codes', async (t) => {
  const logger = createLogger({ name: 'email-test', level: 'silent' });

  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
      },
      logger,
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  t.after(async () => {
    if (connection) await connection.close();
  });

  const { models } = connection;

  /** A transport that records instead of sending, so the code is inspectable. */
  const outbox = [];
  const transport = {
    async sendMail(message) {
      outbox.push(message);
      return { messageId: `test-${outbox.length}` };
    },
  };

  const build = (config = {}) =>
    new EmailService({
      models,
      db: connection,
      logger,
      mailer: new Mailer({ config: { MAIL_FROM: 'test@local' }, logger, transport }),
      config: { EMAIL_BULK_MAX_RECIPIENTS: 500, ...config },
    });

  const seedUser = async ({ withTwoFactor = false } = {}) => {
    const uid = newUid();
    const email = addressFor(uid);
    await models.UserOtps.destroy({ where: { email } });
    await models.User2fa.destroy({ where: { uid: String(uid) } });
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `otp-${uid}`, email, password: 'x', status: 'active' });
    if (withTwoFactor) {
      await models.User2fa.create({ uid: String(uid), is_enabled: true, secret_key: 'SECRET123' });
    }
    return { uid, email };
  };

  /** The code that was actually emailed, read out of the outbox. */
  const lastCode = () => outbox.at(-1).text.match(/code is (\d{6})/)[1];

  /** Age the outstanding code so the cooldown no longer applies. */
  const ageOutstanding = async (email) => {
    const past = new Date(Date.now() - (OTP_RESEND_COOLDOWN_SECONDS + 5) * 1000);
    await models.UserOtps.update({ created_at: past }, { where: { email, is_verified: false } });
  };

  // ══════════════════════════════════════════════════════════════════════
  //  The code is never in a response
  // ══════════════════════════════════════════════════════════════════════

  await t.test('requesting a code does NOT return it', async () => {
    /**
     * `POST /send-otp` ended with
     *
     *     res.status(200).send({ message: 'OTP sent successfully', otp: otp });
     *
     * The caller was handed the code, so anything gated behind it was open to
     * whoever could call the endpoint.
     */
    const { email } = await seedUser();
    const service = build();

    const result = await service.requestOtp({ email, purpose: 'login' });

    assert.equal(result.requested, true);
    assert.equal(result.otp, undefined);
    assert.equal(result.code, undefined);
    assert.equal(
      JSON.stringify(result).match(/\d{6}/),
      null,
      'nothing that looks like a code appears anywhere in the response'
    );

    // It did go to the inbox.
    assert.match(outbox.at(-1).text, /code is \d{6}/);
  });

  await t.test('a code is 6 digits from a cryptographic source', async () => {
    // `randomstring.generate` is `Math.random()` underneath in the numeric
    // charset — predictable enough that the code is not a secret.
    const { email } = await seedUser();
    const service = build();

    const seen = new Set();
    for (let i = 0; i < 5; i += 1) {
      await models.UserOtps.destroy({ where: { email } });
      await service.requestOtp({ email, purpose: 'login' });
      const code = lastCode();
      assert.match(code, /^\d{6}$/);
      seen.add(code);
    }

    assert.ok(seen.size > 1, 'and they are not all the same');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The attempt limit is reachable
  // ══════════════════════════════════════════════════════════════════════

  await t.test('asking for a new code is refused inside the cooldown', async () => {
    /**
     * `/otp/send` had NO cooldown and deleted the outstanding code first, so
     * calling it again reset the attempt counter and sent another email. The
     * cooldown is on issuing, not on which route asked.
     */
    const { email } = await seedUser();
    const service = build();

    await service.requestOtp({ email, purpose: 'login' });

    await assert.rejects(
      () => service.requestOtp({ email, purpose: 'login' }),
      (err) => err.code === 'EMAIL_OTP_COOLDOWN' && err.status === 429
    );
  });

  await t.test('the attempt limit locks a code out, and it cannot be reset by asking again', async () => {
    const { email } = await seedUser();
    const service = build();

    await service.requestOtp({ email, purpose: 'login' });
    const real = lastCode();

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      await assert.rejects(
        () => service.verifyOtp({ email, code: '000000', purpose: 'login' }),
        (err) => err.code === 'EMAIL_OTP_INVALID'
      );
    }

    // The correct code no longer works — the attempts are spent.
    await assert.rejects(
      () => service.verifyOtp({ email, code: real, purpose: 'login' }),
      (err) => err.code === 'EMAIL_OTP_TOO_MANY_ATTEMPTS'
    );

    // And the cooldown stops an immediate reissue from buying three more.
    await assert.rejects(
      () => service.requestOtp({ email, purpose: 'login' }),
      (err) => err.code === 'EMAIL_OTP_COOLDOWN'
    );
  });

  await t.test('an expired code is refused, using the stored deadline', async () => {
    // The row carried `expires_at` and `verifyOTP` ignored it, recomputing the
    // age from `created_at` instead. Two sources of truth for one deadline.
    const { email } = await seedUser();
    const service = build();

    await service.requestOtp({ email, purpose: 'login' });
    const code = lastCode();

    await models.UserOtps.update({ expires_at: new Date(Date.now() - 1000) }, { where: { email } });

    await assert.rejects(
      () => service.verifyOtp({ email, code, purpose: 'login' }),
      (err) => err.code === 'EMAIL_OTP_EXPIRED'
    );
  });

  await t.test('a correct code verifies exactly once', async () => {
    const { email } = await seedUser();
    const service = build();

    await service.requestOtp({ email, purpose: 'login' });
    const code = lastCode();

    assert.deepEqual(await service.verifyOtp({ email, code, purpose: 'login' }), { verified: true });

    // Verified rows are no longer outstanding, so a replay finds nothing.
    await assert.rejects(
      () => service.verifyOtp({ email, code, purpose: 'login' }),
      (err) => err.code === 'EMAIL_OTP_INVALID'
    );
  });

  await t.test('two simultaneous requests leave ONE outstanding code', async () => {
    /**
     * Legacy issued a code with a DELETE followed by an INSERT, two statements
     * with nothing between them. Both requests deleted, both inserted, and the
     * account ended up with two live codes — only one of which was ever checked.
     */
    const { email } = await seedUser();
    const service = build();

    await Promise.allSettled([
      service.requestOtp({ email, purpose: 'login' }),
      service.requestOtp({ email, purpose: 'login' }),
    ]);

    assert.equal(await models.UserOtps.count({ where: { email, is_verified: false } }), 1);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Registration codes work at all
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a registration code can be issued for an address with no account', async () => {
    /**
     * `user_otps.email` carried a FOREIGN KEY to `users(email)`, so a code for
     * an address that has not registered yet violated it on insert. Every
     * registration OTP the platform ever attempted failed. Migration 018 drops
     * the constraint.
     */
    const email = `brand-new-${process.pid}-${Date.now()}@test.local`;
    await models.UserOtps.destroy({ where: { email } });

    const service = build();
    const result = await service.requestOtp({ email, purpose: 'register' });

    assert.equal(result.requested, true);

    const code = lastCode();
    assert.deepEqual(await service.verifyOtp({ email, code, purpose: 'register' }), { verified: true });
  });

  // ══════════════════════════════════════════════════════════════════════
  //  No enumeration oracle
  // ══════════════════════════════════════════════════════════════════════

  await t.test('an unknown address gets the same answer as a known one, and no mail', async () => {
    // Legacy answered `User not found`, which tells an attacker which addresses
    // are registered.
    const service = build();
    const before = outbox.length;

    const result = await service.requestOtp({ email: 'nobody-here@test.local', purpose: 'login' });

    assert.deepEqual(result, { requested: true });
    assert.equal(outbox.length, before, 'and nothing was sent');
  });

  await t.test('a 2FA reset answers identically for missing, without-2FA, and with-2FA', async () => {
    // Three distinguishable answers on an unauthenticated route is a free list
    // of "which accounts exist" and "which have 2FA off".
    const service = build();

    const without = await seedUser();
    const withIt = await seedUser({ withTwoFactor: true });

    const a = await service.requestTwoFactorReset({ identifier: 'ghost@test.local' });
    const b = await service.requestTwoFactorReset({ identifier: without.email });
    const c = await service.requestTwoFactorReset({ identifier: withIt.email });

    assert.deepEqual(a, { requested: true });
    assert.deepEqual(b, { requested: true });
    assert.deepEqual(c, { requested: true });
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Two-factor reset
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a 2FA reset sends to the account address, not one supplied by the caller', async () => {
    const { email } = await seedUser({ withTwoFactor: true });
    const service = build();
    const before = outbox.length;

    await service.requestTwoFactorReset({ identifier: email });

    assert.equal(outbox.length, before + 1);
    assert.equal(outbox.at(-1).to, email);
  });

  await t.test('a verified code disables 2FA, and cannot be spent twice', async () => {
    const { uid, email } = await seedUser({ withTwoFactor: true });
    const service = build();

    await service.requestTwoFactorReset({ identifier: email });
    const code = lastCode();

    assert.deepEqual(await service.confirmTwoFactorReset({ identifier: email, code }), { reset: true });

    const row = await models.User2fa.findOne({ where: { uid: String(uid) }, raw: true });
    assert.equal(row.is_enabled, false);
    assert.equal(row.secret_key, null, 'and the secret is gone, not just the flag');

    // The same code cannot authorise a second reset.
    await assert.rejects(
      () => service.confirmTwoFactorReset({ identifier: email, code }),
      (err) => err.code === 'EMAIL_OTP_INVALID'
    );
  });

  await t.test('a wrong code does not disable 2FA', async () => {
    const { uid, email } = await seedUser({ withTwoFactor: true });
    const service = build();

    await service.requestTwoFactorReset({ identifier: email });

    await assert.rejects(
      () => service.confirmTwoFactorReset({ identifier: email, code: '000000' }),
      (err) => err.code === 'EMAIL_OTP_INVALID'
    );

    const row = await models.User2fa.findOne({ where: { uid: String(uid) }, raw: true });
    assert.equal(row.is_enabled, true);
  });

  await t.test('a username whose value equals another player\'s email does not collide', async () => {
    // Legacy matched with `WHERE email = $1 OR name = $1`.
    const victim = await seedUser({ withTwoFactor: true });

    const impostorId = newUid();
    await models.Users.destroy({ where: { id: impostorId } });
    await models.Users.create({
      id: impostorId,
      // A username that IS the victim's email address.
      name: victim.email,
      email: addressFor(impostorId),
      password: 'x',
      status: 'active',
    });

    const service = build();
    const before = outbox.length;
    await service.requestTwoFactorReset({ identifier: victim.email });

    assert.equal(outbox.length, before + 1);
    assert.equal(outbox.at(-1).to, victim.email, 'the email match wins, so the code goes to the real owner');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Operator email
  // ══════════════════════════════════════════════════════════════════════

  await t.test('an operator may not email an address that is not a player', async () => {
    /**
     * `/email/send` and `/email/bulk` were unauthenticated with both the
     * recipient and the HTML taken from the request — the platform's own
     * sending domain, pointed anywhere.
     */
    const service = build();

    await assert.rejects(
      () =>
        service.sendToPlayer({
          to: 'victim@somewhere-else.com',
          subject: 'Your account is locked',
          content: '<p>click here</p>',
          actor: { id: 1 },
        }),
      (err) => err.code === 'EMAIL_RECIPIENT_NOT_ALLOWED' && err.status === 403
    );
  });

  await t.test('a bulk send refuses if ANY recipient is not a player', async () => {
    const { email } = await seedUser();
    const service = build();
    const before = outbox.length;

    await assert.rejects(
      () =>
        service.sendBulk({
          emails: [email, 'outsider@elsewhere.com'],
          subject: 'Promo',
          content: '<p>hi</p>',
          actor: { id: 1 },
        }),
      (err) => err.code === 'EMAIL_RECIPIENT_NOT_ALLOWED'
    );

    assert.equal(outbox.length, before, 'and nothing was sent to the valid one either');
  });

  await t.test('a bulk send reports per-recipient results', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const service = build();

    const result = await service.sendBulk({
      emails: [a.email, b.email, a.email],
      subject: 'Promo',
      content: '<p>hi</p>',
      actor: { id: 1 },
    });

    assert.equal(result.sent, 2, 'the duplicate is collapsed');
    assert.equal(result.failed, 0);
    assert.equal(result.results.length, 2);
  });

  await t.test('a bulk send over the cap is refused', async () => {
    const { email } = await seedUser();
    const service = build({ EMAIL_BULK_MAX_RECIPIENTS: 1 });

    await assert.rejects(
      () =>
        service.sendBulk({
          emails: [email, addressFor(newUid())],
          subject: 'x',
          content: 'y',
          actor: { id: 1 },
        }),
      (err) => err.code === 'EMAIL_TOO_MANY_RECIPIENTS'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Delivery failure is not success
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a code that could not be delivered is reported as a failure', async () => {
    // "We sent it" when we did not is what makes a player wait for an email
    // that is not coming.
    const { email } = await seedUser();

    const service = new EmailService({
      models,
      db: connection,
      logger,
      // No SMTP configuration at all.
      mailer: new Mailer({ config: {}, logger }),
      config: {},
    });

    await assert.rejects(
      () => service.requestOtp({ email, purpose: 'login' }),
      (err) => err.code === 'EMAIL_SEND_FAILED'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Templates
  // ══════════════════════════════════════════════════════════════════════

  await t.test('template values are escaped', async () => {
    const rendered = renderOtp({ code: '<script>x</script>', purpose: 'login', ttlSeconds: 120 });
    assert.ok(!rendered.html.includes('<script>'));
    assert.ok(rendered.html.includes('&lt;script&gt;'));
  });

  await t.test('a call-to-action link must be http(s)', async () => {
    assert.equal(safeUrl('javascript:alert(1)'), null);
    assert.equal(safeUrl('data:text/html,x'), null);
    assert.equal(safeUrl('/relative'), null);
    assert.equal(safeUrl('https://example.com/a?b=c'), 'https://example.com/a?b=c');

    const rendered = renderGeneral({
      subject: 's',
      content: '<p>body</p>',
      ctaLink: 'javascript:alert(1)',
      ctaText: 'Click',
    });
    assert.ok(!rendered.html.includes('javascript:'), 'a refused link produces no button at all');
  });

  await t.test('the code email states the real validity window', async () => {
    // The legacy template said "Valid for 2 minutes only" as static text, so
    // changing the TTL would leave the email contradicting the system.
    const rendered = renderOtp({ code: '123456', purpose: 'login', ttlSeconds: 600 });
    assert.match(rendered.html, /Valid for 10 minutes/);
    assert.ok(!rendered.html.includes('2 minutes'));
  });

  // Referenced so the helper is exercised where a cooldown would otherwise
  // block a legitimate reissue.
  await t.test('a reissue is allowed once the cooldown has passed', async () => {
    const { email } = await seedUser();
    const service = build();

    await service.requestOtp({ email, purpose: 'login' });
    await ageOutstanding(email);

    const again = await service.requestOtp({ email, purpose: 'login' });
    assert.equal(again.requested, true);
    assert.equal(await models.UserOtps.count({ where: { email, is_verified: false } }), 1);
  });
});
