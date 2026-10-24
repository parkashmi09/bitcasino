'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { hashToken, verifyPassword } = require('@ibitplay/auth');

const { AuthService } = require('../auth.service');
const { EmailService } = require('../../email/email.service');

/**
 * Registration and password reset.
 *
 * The reset tests are the important ones. Legacy's "forgot password" read the
 * CLEARTEXT PASSWORD out of `password2` and emailed it — which is why that
 * column exists, and why it could not simply be cleared.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;
let sent = [];

test('registration and password reset', async (t) => {
  const logger = createLogger({ name: 'registration-test', level: 'silent' });

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

  const { models } = connection;

  /** A mailer that records instead of sending. */
  const mailer = { send: async (message) => sent.push(message) };

  const service = new AuthService({
    models,
    db: connection,
    logger,
    mailer,
    config: {
      // `JWT_ACCESS_SECRET`, not `JWT_SECRET` — `TokenService` throws in its
      // constructor otherwise, which surfaces as the whole file hanging rather
      // than as a failed assertion.
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
      JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
    },
  });

  const created = [];
  const unique = `r${process.pid}${Date.now().toString(36).slice(-4)}`;

  const signUp = async (suffix, overrides = {}) => {
    const account = await service.register({
      username: `${unique}${suffix}`,
      password: 'correct-horse-battery',
      email: `${unique}${suffix}@test.invalid`,
      ...overrides,
    });
    created.push(Number(account.id));
    return account;
  };

  t.after(async () => {
    for (const id of created) {
      await models.AuthVerificationToken.destroy({ where: { user_id: id } });
      await models.UserOtps.destroy({ where: { user_id: id } });
      await models.AuthSession.destroy({ where: { user_id: id } });
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }
    if (connection) await connection.close();
  });

  // ══════════════════════════════════════════════════════════════════════

  await t.test('a registration creates the account and its wallet', async () => {
    const account = await signUp('a');

    const user = await models.Users.findOne({ where: { id: account.id }, raw: true });
    assert.equal(user.name, `${unique}a`);
    assert.equal(user.status, 'active');
    assert.ok(user.referalcode, 'and a referral code');

    const credits = await models.Credits.findOne({ where: { uid: account.id }, raw: true });
    assert.ok(credits, 'the wallet row exists');
  });

  await t.test('THE REPLY CONTAINS NO PASSWORD', async () => {
    /**
     * Legacy: `callback({ status: true, uid, name, password: password })` —
     * sent back to the client that had just typed it.
     */
    const account = await signUp('b');
    assert.equal('password' in account, false);
    assert.deepEqual(Object.keys(account).sort(), ['email', 'id', 'name']);
  });

  await t.test('THE PASSWORD IS HASHED AND `password2` IS LEFT NULL', async () => {
    const account = await signUp('c');
    const user = await models.Users.findOne({ where: { id: account.id }, raw: true });

    assert.notEqual(user.password, 'correct-horse-battery');
    assert.ok(user.password.startsWith('$2'));
    // `createUser` wrote the cleartext here. Nothing does now.
    assert.equal(user.password2, null);
  });

  await t.test('the id is not sequential', async () => {
    // A player's id is visible to them; a sequential one leaks how many
    // customers the platform has and in what order they joined.
    const first = await signUp('d');
    const second = await signUp('e');
    assert.notEqual(Number(second.id) - Number(first.id), 1);
    assert.ok(Number(first.id) >= 1_000_000_000);
  });

  await t.test('a duplicate username is a 409, not a 500', async () => {
    await assert.rejects(
      () => service.register({ username: `${unique}a`, password: 'correct-horse-battery', email: 'other@test.invalid' }),
      (err) => err.code === 'AUTH_ALREADY_REGISTERED' && err.details.field === 'username'
    );
  });

  await t.test('a duplicate email is refused too, and says which field', async () => {
    await assert.rejects(
      () => service.register({ username: `${unique}zz`, password: 'correct-horse-battery', email: `${unique}a@test.invalid` }),
      (err) => err.code === 'AUTH_ALREADY_REGISTERED' && err.details.field === 'email'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Password reset
  // ══════════════════════════════════════════════════════════════════════

  await t.test('A RESET EMAILS A TOKEN — NOT THE PASSWORD', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * `Rule.resetClientPassword`:
     *
     *     Rule.getPassword2ById(user_id, (password) => {
     *       console.log('Password lookup result:', password);
     *       ...
     *       Email.passwordReset(email, password, name, ...)
     *
     * It read the cleartext password and sent it. The email body said "Your
     * New Password" above the old one, and the password was logged twice on
     * the way — here and in `Email.passwordReset`'s first line.
     * ═══════════════════════════════════════════════════════════════════
     */
    const account = await signUp('f');
    sent = [];

    await service.requestPasswordReset({ email: `${unique}f@test.invalid` });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].template, 'password-reset');
    assert.ok(sent[0].data.token, 'a token was sent');
    assert.equal('password' in sent[0].data, false, 'and the password was not');

    // The token is stored HASHED — a database read is not a working link.
    const stored = await models.AuthVerificationToken.findOne({
      where: { user_id: account.id, purpose: 'password_reset' },
      raw: true,
    });
    assert.equal(stored.token_hash, hashToken(sent[0].data.token));
    assert.notEqual(stored.token_hash, sent[0].data.token);
  });

  await t.test('AN UNKNOWN ADDRESS ANSWERS IDENTICALLY', async () => {
    // Legacy answered `{status: true}` for a known email and `{status: false}`
    // for an unknown one, which makes the reset box a membership check.
    sent = [];

    const known = await service.requestPasswordReset({ email: `${unique}f@test.invalid` });
    const unknown = await service.requestPasswordReset({ email: 'nobody-at-all@test.invalid' });

    assert.deepEqual(known, unknown);
    assert.equal(sent.length, 1, 'and only the real address was mailed');
  });

  await t.test('the token resets the password and CLEARS `password2`', async () => {
    const account = await signUp('g');

    // Seed the legacy cleartext column, as every legacy write path did.
    await models.Users.update({ password2: 'correct-horse-battery' }, { where: { id: account.id } });

    sent = [];
    await service.requestPasswordReset({ email: `${unique}g@test.invalid` });
    const { token } = sent[0].data;

    await service.completePasswordReset({ token, newPassword: 'a-completely-different-one' });

    const user = await models.Users.findOne({ where: { id: account.id }, raw: true });
    assert.equal(await verifyPassword('a-completely-different-one', user.password), true);
    assert.equal(user.password2, null, 'the cleartext copy is gone for this account');
  });

  await t.test('A TOKEN IS SINGLE USE', async () => {
    const account = await signUp('h');
    sent = [];
    await service.requestPasswordReset({ email: `${unique}h@test.invalid` });
    const { token } = sent[0].data;

    await service.completePasswordReset({ token, newPassword: 'first-new-password' });

    await assert.rejects(
      () => service.completePasswordReset({ token, newPassword: 'second-new-password' }),
      (err) => err.code === 'AUTH_RESET_TOKEN_INVALID'
    );

    const user = await models.Users.findOne({ where: { id: account.id }, raw: true });
    assert.equal(await verifyPassword('first-new-password', user.password), true, 'the first reset stands');
  });

  await t.test('a second request invalidates the first token', async () => {
    /**
     * Otherwise every email ever sent stays live until it expires — and the
     * oldest is the one most likely to have leaked.
     */
    const account = await signUp('i');
    sent = [];

    await service.requestPasswordReset({ email: `${unique}i@test.invalid` });
    const firstToken = sent[0].data.token;

    await service.requestPasswordReset({ email: `${unique}i@test.invalid` });
    const secondToken = sent[1].data.token;

    await assert.rejects(
      () => service.completePasswordReset({ token: firstToken, newPassword: 'x-new-password' }),
      (err) => err.code === 'AUTH_RESET_TOKEN_INVALID'
    );

    await service.completePasswordReset({ token: secondToken, newPassword: 'y-new-password' });
    const user = await models.Users.findOne({ where: { id: account.id }, raw: true });
    assert.equal(await verifyPassword('y-new-password', user.password), true);
  });

  await t.test('an expired token is refused', async () => {
    const account = await signUp('j');
    sent = [];
    await service.requestPasswordReset({ email: `${unique}j@test.invalid` });
    const { token } = sent[0].data;

    await models.AuthVerificationToken.update(
      { expires_at: new Date(Date.now() - 1000) },
      { where: { user_id: account.id, purpose: 'password_reset' } }
    );

    await assert.rejects(
      () => service.completePasswordReset({ token, newPassword: 'never-applied' }),
      (err) => err.code === 'AUTH_RESET_TOKEN_INVALID'
    );
  });

  await t.test('a made-up token and an expired one answer identically', async () => {
    // A caller learns the link does not work, not which of the three reasons.
    const bogus = await service
      .completePasswordReset({ token: 'not-a-real-token', newPassword: 'x-new-password' })
      .catch((e) => e);

    assert.equal(bogus.code, 'AUTH_RESET_TOKEN_INVALID');
  });

  await t.test('A RESET REVOKES EVERY SESSION', async () => {
    /**
     * A reset is what somebody does when they believe their account is
     * compromised. Leaving the attacker's session live would defeat it.
     */
    const account = await signUp('k');

    await service.login(
      { identifier: `${unique}k`, password: 'correct-horse-battery' },
      { ip: '127.0.0.1', userAgent: 'test' }
    );
    assert.equal(await models.AuthSession.count({ where: { user_id: account.id, revoked_at: null } }), 1);

    sent = [];
    await service.requestPasswordReset({ email: `${unique}k@test.invalid` });
    await service.completePasswordReset({ token: sent[0].data.token, newPassword: 'brand-new-password' });

    assert.equal(
      await models.AuthSession.count({ where: { user_id: account.id, revoked_at: null } }),
      0,
      'every session ended'
    );
  });

  await t.test('reusing the current password is refused', async () => {
    const account = await signUp('l');
    sent = [];
    await service.requestPasswordReset({ email: `${unique}l@test.invalid` });

    await assert.rejects(
      () => service.completePasswordReset({ token: sent[0].data.token, newPassword: 'correct-horse-battery' }),
      (err) => err.code === 'AUTH_PASSWORD_REUSED'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Recovery by one-time CODE — the path the web client uses
  //
  //  `POST /email/otp` → `POST /email/otp/verify` → `POST /auth/reset-password`
  //
  //  The first two routes have existed since the port. Nothing spent a
  //  `reset-password` proof and `completePasswordReset` was exposed on no
  //  transport, so the platform could issue a recovery code, confirm it was
  //  correct, and then had no way to change the password.
  // ══════════════════════════════════════════════════════════════════════

  /**
   * A mailer that satisfies `EmailService`, which checks `result.sent`.
   *
   * The one above answers the array length, which is truthy and has no `sent`
   * key — `requestOtp` would read that as a failed send and throw
   * `EMAIL_SEND_FAILED`, which presents as "the OTP tests are broken" rather
   * than "the mailer stub is the wrong shape".
   */
  let posted = [];
  const otpMailer = {
    send: async (message) => {
      posted.push(message);
      return { sent: true };
    },
  };

  const emails = new EmailService({
    models,
    db: connection,
    logger,
    mailer: otpMailer,
    config: {},
  });

  /** The code is never in a response. The only place to read it is the email. */
  const codeFromMail = () => {
    const match = /Your code is (\d{6})/.exec(posted.at(-1)?.text ?? '');
    assert.ok(match, 'the OTP email carried no code');
    return match[1];
  };

  /** Issue and verify a code, leaving a spendable proof. */
  const provenCode = async (email) => {
    posted = [];
    await emails.requestOtp({ email, purpose: 'reset-password' });
    const code = codeFromMail();
    await emails.verifyOtp({ email, code, purpose: 'reset-password' });
    return code;
  };

  const resetWithCode = (email, code, newPassword) =>
    service.resetPasswordWithCode({
      newPassword,
      spendProof: () => emails.spendProofWithCode({ email, code, purpose: 'reset-password' }),
    });

  await t.test('THE CODE IS NEVER IN A RESPONSE, ONLY IN THE EMAIL', async () => {
    // Legacy's `POST /send-otp` answered `{message, otp}` — it handed the
    // caller the code. A one-time code the requester is told is not a factor.
    await signUp('m');
    posted = [];
    const answer = await emails.requestOtp({
      email: `${unique}m@test.invalid`,
      purpose: 'reset-password',
    });

    assert.equal(answer.otp, undefined);
    assert.equal(JSON.stringify(answer).includes(codeFromMail()), false);
  });

  await t.test('a verified code sets the password and clears `password2`', async () => {
    const account = await signUp('n');
    const email = `${unique}n@test.invalid`;
    const code = await provenCode(email);

    const result = await resetWithCode(email, code, 'a-brand-new-passphrase');
    assert.equal(result.reset, true);

    const row = await models.Users.findByPk(account.id);
    assert.ok(await verifyPassword('a-brand-new-passphrase', row.password));
    assert.equal(row.password2, null, 'the cleartext column is cleared by this path too');
  });

  await t.test('THE PROOF IS SINGLE USE', async () => {
    const email = `${unique}o@test.invalid`;
    await signUp('o');
    const code = await provenCode(email);

    await resetWithCode(email, code, 'first-new-passphrase');

    // The same verification must not authorise a second reset — otherwise a
    // code that leaked after being used is still a working account takeover.
    await assert.rejects(
      () => resetWithCode(email, code, 'second-new-passphrase'),
      (err) => err.code === 'EMAIL_OTP_INVALID'
    );
  });

  await t.test('A WRONG CODE IS REFUSED EVEN THOUGH A PROOF EXISTS', async () => {
    /**
     * The security property this whole route hangs on.
     *
     * `spendProof` — the version `profile.changeEmail` uses — is keyed on the
     * address alone, which is fine there because that request already carries
     * the account holder's token. This one is UNAUTHENTICATED, so a spend
     * keyed on the address would mean: for the five minutes after a victim
     * verifies their own code, any caller naming that address owns the
     * account, having never seen the code.
     */
    const email = `${unique}p@test.invalid`;
    const account = await signUp('p');
    const code = await provenCode(email);

    const wrong = code === '000000' ? '111111' : '000000';
    await assert.rejects(
      () => resetWithCode(email, wrong, 'attackers-passphrase'),
      (err) => err.code === 'EMAIL_OTP_INVALID'
    );

    // And the password did not move.
    const row = await models.Users.findByPk(account.id);
    assert.ok(await verifyPassword('correct-horse-battery', row.password));
  });

  await t.test('a wrong code does NOT burn the proof', async () => {
    // A mistyped digit must not send somebody back to the start of the flow.
    const email = `${unique}q@test.invalid`;
    await signUp('q');
    const code = await provenCode(email);

    await assert.rejects(() => resetWithCode(email, '000001', 'nope-passphrase'));
    const result = await resetWithCode(email, code, 'the-real-new-passphrase');
    assert.equal(result.reset, true);
  });

  await t.test('AN UNVERIFIED CODE IS NOT A PROOF', async () => {
    // Issued but never run through `/otp/verify`. The row exists with
    // `is_verified: false`, and the reset must not accept it — otherwise the
    // verify step is decorative and the attempt counter never applies.
    const email = `${unique}r@test.invalid`;
    await signUp('r');
    posted = [];
    await emails.requestOtp({ email, purpose: 'reset-password' });

    await assert.rejects(
      () => resetWithCode(email, codeFromMail(), 'skipped-a-step-passphrase'),
      (err) => err.code === 'EMAIL_OTP_INVALID'
    );
  });

  await t.test('A PROOF FOR ONE PURPOSE CANNOT RESET A PASSWORD', async () => {
    /**
     * Purpose confinement. `reset-2fa` and `change-email` codes go to the same
     * inbox and live in the same table; without the purpose in the lookup, a
     * code issued to turn off two-factor would also set a new password —
     * which is the more valuable of the two actions.
     */
    const email = `${unique}s@test.invalid`;
    await signUp('s');
    posted = [];
    await emails.requestOtp({ email, purpose: 'login' });
    const code = codeFromMail();
    await emails.verifyOtp({ email, code, purpose: 'login' });

    await assert.rejects(
      () => resetWithCode(email, code, 'wrong-purpose-passphrase'),
      (err) => err.code === 'EMAIL_OTP_INVALID'
    );
  });

  await t.test('A CODE RESET REVOKES EVERY SESSION', async () => {
    // Same guarantee the token path gives. A reset is what somebody does when
    // they believe the account is compromised.
    const email = `${unique}t@test.invalid`;
    const account = await signUp('t');

    await service.login(
      { identifier: `${unique}t`, password: 'correct-horse-battery' },
      { ip: '127.0.0.1', userAgent: 'test' }
    );
    assert.equal(await models.AuthSession.count({ where: { user_id: account.id, revoked_at: null } }), 1);

    const code = await provenCode(email);
    await resetWithCode(email, code, 'revoke-everything-passphrase');

    assert.equal(
      await models.AuthSession.count({ where: { user_id: account.id, revoked_at: null } }),
      0,
      'every session ended'
    );
  });

  await t.test('reusing the current password is refused on this path too', async () => {
    const email = `${unique}u@test.invalid`;
    await signUp('u');
    const code = await provenCode(email);

    await assert.rejects(
      () => resetWithCode(email, code, 'correct-horse-battery'),
      (err) => err.code === 'AUTH_PASSWORD_REUSED'
    );
  });
});
