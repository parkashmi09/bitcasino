'use strict';

const { EVENTS, AUDIENCE } = require('@ibitplay/socket');

const errors = require('./auth.errors');
const { AuthService } = require('./auth.service');
/**
 * Enrolment lives in the `twofa` module, which owns the secret and its
 * lifecycle. This file only routes to it — one implementation, two transports,
 * the same reason `AuthService` is reused for login.
 */
const { TwoFactorService } = require('../twofa/twofa.service');

/**
 * The authentication socket events.
 *
 * Twelve events, all of which route through the SAME `AuthService` the HTTP
 * routes use. Nothing here reimplements a credential check — the throttle, the
 * constant-time comparison, the session chain and the 2FA verification are one
 * implementation with two transports in front of it.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 1. TWO-FACTOR AUTHENTICATION WAS NOT A GATE
 *
 * `Rule.login`, when the account has 2FA enabled:
 *
 *     Token.create(token, user_id, (created) => {
 *       if (created) {
 *         Rule.get2FaStatus(user_id, (need2Fa) => {
 *           if (need2Fa) {
 *             callback({ status: "2fa", token: token, password: password });
 *
 * The token is minted and INSERTED INTO `tokens` before the second factor is
 * considered, and then handed to the client. `Token.getID` — which is what
 * `C.ONLINE_LOGGED` authenticates with — looks tokens up in exactly that
 * table. So the pre-2FA token is a fully working session.
 *
 * `Rule.confirmTwoFa` then returns *the same token it was given*. There is no
 * second credential anywhere in the flow. The client is handed a live session,
 * told "now do 2FA", and trusted not to simply use what it already has.
 *
 * `AuthService.login` verifies the code BEFORE `#issueSession` is reached.
 *
 * ── 2. AND IT RETURNED THE CLEARTEXT PASSWORD ────────────────────────────
 *
 *     callback({ status: "2fa", token: token, password: password });
 *
 * The password the user just typed, sent back over the socket. It is then held
 * in the client's memory until the 2FA step, and `Rule.confirmTwoFa` takes it
 * as a parameter — so the client is expected to keep it and send it again.
 * Nothing here returns a password.
 *
 * ── 3. THE CAPTCHA HAD A BYPASS STRING ───────────────────────────────────
 *
 *     if (recaptcha === "google" || response.success) {
 *
 * Sending the literal `"google"` skips the check. Whatever the captcha was
 * protecting against — credential stuffing, mass registration — was protected
 * by a five-letter constant that shipped in the source.
 *
 * ── 4. AND THE RESPONSES ENUMERATED USERS ────────────────────────────────
 *
 *     return callback({ status: "Username Not Found" });
 *     return callback({ status: "Password incorrect" });
 *
 * Two distinguishable answers, so the login endpoint is a membership oracle:
 * a list of emails in, a list of customers out. `INVALID_CREDENTIALS` is one
 * code for both — see `auth.errors.js`.
 */

/** Legacy's reply shape. Clients read `status` and branch on it. */
const ok = (payload) => ({ status: true, ...payload });

/**
 * Refusals keep legacy's `{ status: <message> }` shape.
 *
 * Existing clients test `result.status === true` and otherwise display
 * `result.status` as text. Returning a structured error alone would show them
 * `[object Object]`, so the message is in the place they already look and the
 * machine-readable code rides alongside for anything newer.
 */
const refuse = (error) => ({ status: error.message, error: { code: error.code } });

function register({ on, deps }) {
  const service = new AuthService(deps);
  const twoFa = new TwoFactorService(deps);
  const { logger } = deps;

  /**
   * @legacy SOCKET faf9ba208ad90e7313b6ffafde53b801
   *
   * `C.LOGIN_USER`.
   */
  on(EVENTS.LOGIN_USER, {
    audience: AUDIENCE.PUBLIC,
    // Tighter than the audience default: this is the credential-guessing
    // event, and legacy metered it nowhere.
    limit: { windowMs: 60_000, max: 10 },
    handle: async (payload, context) => {
      const { username, password, twoFactorCode } = payload ?? {};

      try {
        const session = await service.login(
          { identifier: String(username ?? ''), password: String(password ?? ''), twoFactorCode },
          { ip: context.ip, userAgent: context.userAgent, deviceLabel: 'socket' }
        );

        /**
         * The socket's identity is updated in place, so events sent on this
         * same connection after a successful login are authenticated. Legacy
         * captured `id` in the connection closure at connect time and could
         * never update it — which is why it had a separate `C.ONLINE_LOGGED`
         * round trip just to re-authenticate the socket it was already on.
         */
        context.userId = session.user.id;
        context.socket.join(`user:${session.user.id}`);

        return ok({
          uid: String(session.user.id),
          token: session.accessToken,
          refreshToken: session.refreshToken,
          name: session.user.name,
          email: session.user.email,
          country: session.user.country,
          avatar: session.user.avatar,
        });
      } catch (error) {
        if (error.code === errors.TWO_FACTOR_REQUIRED.code) {
          /**
           * Legacy's clients branch on `status === "2fa"`, so that string is
           * kept — but NO TOKEN and NO PASSWORD go with it. The client has to
           * send the code back with the credentials, which is what makes the
           * second factor a factor.
           */
          return { status: '2fa' };
        }
        if (error.code?.startsWith('AUTH_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 383f7bf0257c3ef6cab20278dd1579be
   *
   * `C.LOGIN_USER_GOOGLE`.
   *
   * ─────────────────────────────────────────────────────────────────────
   * LEGACY TRUSTED THE CLIENT'S CLAIM ABOUT WHO GOOGLE SAID THEY WERE
   *
   * `Rule.loginByGoogle(username, email, token, …)` receives the email as a
   * PARAMETER from the message. Whatever verification it does of `token`, the
   * account it logs into is chosen by `email` — so the question is whether the
   * two are ever checked against each other.
   *
   * Not ported until that is settled. Answering with a clear refusal is
   * better than shipping a guess at a federated-identity flow: the wrong guess
   * here is "anyone can sign in as anyone with a Google button".
   * ─────────────────────────────────────────────────────────────────────
   */
  on(EVENTS.LOGIN_USER_GOOGLE, {
    audience: AUDIENCE.PUBLIC,
    limit: { windowMs: 60_000, max: 10 },
    handle: async () => {
      logger?.warn('Google sign-in was attempted over the socket and is not ported — see auth/sockets.js');
      return refuse(errors.PROVIDER_NOT_AVAILABLE());
    },
  });

  /**
   * @legacy SOCKET 7f76165777d11ee5836777d85df2cdab
   *
   * `C.ONLINE` — "who am I?", asked by an already-connected socket.
   */
  on(EVENTS.ONLINE, {
    audience: AUDIENCE.PUBLIC,
    handle: async (_payload, context) => {
      if (!context.userId) return { status: false };
      const me = await service.me(context.userId);
      return ok({ uid: String(me.id), name: me.name, email: me.email, avatar: me.avatar });
    },
  });

  /**
   * @legacy SOCKET 158231da52345s194323232211136d91b50
   *
   * `C.TWO_FA_CONFIRM` — enrol in two-factor authentication.
   *
   * ─────────────────────────────────────────────────────────────────────
   * LEGACY USED ONE EVENT FOR TWO DIFFERENT THINGS
   *
   * `Rule.confirmTwoFa` both VERIFIES a code and runs
   * `UPDATE users SET two_fa_status = true` — so the event that completes a
   * login is the same one that turns 2FA on. Enrolment and verification are
   * different operations with different preconditions, and conflating them is
   * how the login path ended up returning a live token before the code was
   * checked.
   *
   * Verification at login is part of `LOGIN_USER` now. This event is
   * enrolment only.
   * ─────────────────────────────────────────────────────────────────────
   */
  on(EVENTS.TWO_FA_CONFIRM, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 10 },
    handle: async (payload, context) => {
      const { code } = payload ?? {};
      try {
        await twoFa.completeSetup(context.userId, { code: String(code ?? '') });
        return ok({ twoFactor: 'enabled' });
      } catch (error) {
        if (error.code?.startsWith('AUTH_') || error.code?.startsWith('TWOFA_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 1582223323345s19432325311136d91b50
   *
   * `C.TWO_FA_DISABLE`.
   */
  on(EVENTS.TWO_FA_DISABLE, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 10 },
    handle: async (payload, context) => {
      const { code, password } = payload ?? {};
      try {
        await twoFa.disable(context.userId, {
          code: String(code ?? ''),
          // `disable` requires the password as well as the code. Legacy's
          // `disableTwoFa` did too, and that is right — turning the second
          // factor off should cost as much as using it.
          password: String(password ?? ''),
        });
        return ok({ twoFactor: 'disabled' });
      } catch (error) {
        if (error.code?.startsWith('AUTH_') || error.code?.startsWith('TWOFA_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 1f7009c5312bab76e660578ecbe08350
   *
   * `C.LOGOUT_USER`.
   *
   * ─────────────────────────────────────────────────────────────────────
   * LEGACY'S LOGOUT DID NOT END THE SESSION
   *
   *     client.on(C.LOGOUT_USER, (data) => { Token.refresh(id, () => {}); });
   *
   * `Token.refresh` replaces the row in `tokens` with a new random string. The
   * credential the client holds is a JWT valid for `expiresIn: 129600` — 36
   * hours — and nothing revokes it. The socket path re-reads `tokens`, so
   * logout works *there*; anything verifying the JWT directly does not see it.
   *
   * (The replacement was also `H.randomString(25)`, which is `Math.random()`.)
   *
   * Here the session row is revoked, which is what both transports check.
   * ─────────────────────────────────────────────────────────────────────
   */
  on(EVENTS.LOGOUT_USER, {
    audience: AUDIENCE.USER,
    handle: async (payload, context) => {
      const { refreshToken, allSessions } = payload ?? {};
      await service.logout({ refreshToken, allSessions: Boolean(allSessions) }, { id: context.userId });

      context.socket.leave(`user:${context.userId}`);
      context.userId = null;

      return ok({ loggedOut: true });
    },
  });

  /**
   * @legacy SOCKET 0a2637735ee07dd5f0e5eba7b9ca1ce7
   *
   * `C.REGISTER_USER`.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE REGISTRATION REPLY CONTAINED THE PASSWORD
   *
   *     return callback({ status: true, uid: result, name: username,
   *                       password: password, error: false });
   *
   * Sent back to the client that had just typed it. Third place in the login
   * flows alone that a cleartext password crosses the wire.
   *
   * And `Rule.register` has NO CAPTCHA — `Rule.login` at least attempts one
   * (with a bypass string), while registration has nothing, so mass account
   * creation is free. The rate limit below is the floor, not a substitute for
   * one.
   *
   * The duplicate checks were also read-then-insert with two awaits between,
   * so two simultaneous registrations of the same name both passed. The unique
   * constraint is what actually holds; `register` surfaces it as a 409.
   * ─────────────────────────────────────────────────────────────────────
   */
  on(EVENTS.REGISTER_USER, {
    audience: AUDIENCE.PUBLIC,
    limit: { windowMs: 60 * 60_000, max: 5 },
    handle: async (payload, context) => {
      const { username, password, email, phone, refree, country } = payload ?? {};
      try {
        const created = await service.register(
          {
            username: String(username ?? '').trim(),
            password: String(password ?? ''),
            email: String(email ?? '').trim().toLowerCase(),
            phone: phone ? String(phone).trim() : null,
            referredBy: refree ? String(refree).trim() : null,
            country: country ? String(country).trim() : null,
          },
          { ip: context.ip, userAgent: context.userAgent }
        );

        // No password in the reply.
        return ok({ uid: String(created.id), name: created.name, error: false });
      } catch (error) {
        if (error.code?.startsWith('AUTH_')) return { ...refuse(error), error: error.message };
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 62a0b91a9b98a7ec19f27e72c13de207
   *
   * `C.RESET_PASSWORD`.
   *
   * See `AuthService.requestPasswordReset` for what legacy did — in short, it
   * read the cleartext password out of `password2` and emailed it.
   */
  on(EVENTS.RESET_PASSWORD, {
    audience: AUDIENCE.PUBLIC,
    // A reset request sends mail to an address the caller names. Unmetered,
    // that is a way to have this platform email anybody repeatedly.
    limit: { windowMs: 60 * 60_000, max: 5 },
    handle: async (payload, context) => {
      const { email } = payload ?? {};
      await service.requestPasswordReset({ email }, { ip: context.ip });

      /**
       * `status: true` unconditionally. Legacy answered `true` for a known
       * address and `false` for an unknown one, which turns the reset box into
       * a membership check.
       */
      return ok({ requested: true });
    },
  });

  /**
   * @legacy SOCKET ed7feda03376fd39087183552f093e6a
   *
   * `C.EDIT_PASSWORD`.
   *
   * ═════════════════════════════════════════════════════════════════════
   * IT DID NOT ASK FOR THE CURRENT PASSWORD
   *
   *     client.on(C.EDIT_PASSWORD, (data) => {
   *       let { password } = decode(data);
   *       if (!id) return;
   *       Rule.editPassword(id, password, ...)
   *
   * and `Rule.editPassword` hashes the new one, stores it, and writes the
   * cleartext to `password2` — with no re-authentication anywhere.
   *
   * Any authenticated socket could change the account password without
   * knowing the current one. Combined with the pre-2FA token: sign in with a
   * stolen password, receive a working token before the second factor, use it
   * to change the password. 2FA never enters it.
   *
   * `changePassword` verifies the current password, refuses reuse, and
   * revokes every other session.
   * ═════════════════════════════════════════════════════════════════════
   */
  on(EVENTS.EDIT_PASSWORD, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 5 },
    handle: async (payload, context) => {
      const { currentPassword, password } = payload ?? {};
      try {
        const result = await service.changePassword(
          { currentPassword: String(currentPassword ?? ''), newPassword: String(password ?? '') },
          { id: context.userId }
        );
        return ok({ revokedSessions: result.revokedSessions });
      } catch (error) {
        if (error.code?.startsWith('AUTH_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET faf9ba208bd90e2313b6faeede53b801
   *
   * `C.ONLINE_LOGGED` — bind an already-open socket to a player who has just
   * logged in.
   *
   * ═════════════════════════════════════════════════════════════════════
   * WHY THIS EVENT EXISTS, AND WHY IT IS PUBLIC
   *
   * A visitor arrives signed out. The socket opens with no token and is
   * anonymous. They then log in — over HTTP or over `C.LOGIN_USER` — and now
   * hold a token that the already-open connection knows nothing about. Every
   * `USER` event on that socket would be refused until they reload the page.
   *
   * So the audience is `PUBLIC` by necessity: an anonymous connection is
   * exactly who sends it. What makes it safe is that the token is verified by
   * the transport (`context.bind`), not by this handler — the handler never
   * sees an id it could trust or set.
   *
   * ── WHAT LEGACY DID WITH IT ──────────────────────────────────────────
   *
   *     client.on(C.ONLINE_LOGGED, (data) => {
   *       let { token } = decode(data);
   *       if (!token) return;
   *       Token.getID(token, (idd) => {
   *         if (idd) recordLogin(idd, ip, ua);
   *         Rule.authentication(client, idd, (result) => { ... });
   *       });
   *     });
   *
   * `idd` is reassigned into the connection's scope, which is how a socket
   * became "logged in". Two problems came with it:
   *
   *   `Token.getID` returning nothing still called `Rule.authentication(client,
   *   undefined, …)`, so a bad token produced an authenticated-looking reply
   *   for user `undefined` rather than a refusal.
   *
   *   The old identity's room was never left. A socket that authenticated as
   *   one player and then another kept receiving the first player's private
   *   pushes for as long as it stayed open. `context.bind` leaves it.
   */
  on(EVENTS.ONLINE_LOGGED, {
    audience: AUDIENCE.PUBLIC,
    // A login is a once-in-a-session action. A loop here is somebody trying
    // tokens, and legacy metered nothing.
    limit: { windowMs: 60_000, max: 10 },
    handle: async (payload, context) => {
      const token = payload?.token;
      if (!token) return { status: false, msg: 'A token is required' };

      const userId = await context.bind(token);
      // A refusal, not an authenticated reply for `undefined`.
      if (!userId) return { status: false, msg: 'That session is not valid' };

      const me = await service.me(userId);

      return ok({
        uid: String(me.id),
        name: me.name,
        email: me.email,
        avatar: me.avatar,
        level: me.level,
        twoFa: me.two_fa_status === true,
      });
    },
  });

  /**
   * @legacy SOCKET 158231da5231e9ab76b2323232136d91b50
   *
   * `C.TWO_FA` — start enrolling in two-factor authentication.
   *
   * The counterpart to `TWO_FA_CONFIRM` and `TWO_FA_DISABLE`, both of which
   * are already registered above. Legacy's `Rule.generateTwoFa` wrote the
   * secret and returned it; enrolment only completes when a code proves the
   * authenticator works, which is `TWO_FA_CONFIRM`.
   */
  on(EVENTS.TWO_FA, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 10 },
    handle: async (_payload, context) => {
      try {
        const setup = await twoFa.beginSetup(context.userId, {});
        return ok(setup);
      } catch (error) {
        if (error.code?.startsWith('TWOFA_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 002b67aa7d872615cc6ef9ffa78c766d
   *
   * `C.GET_UID`.
   */
  on(EVENTS.GET_UID, {
    audience: AUDIENCE.USER,
    handle: async (_payload, context) => String(context.userId),
  });
}

module.exports = { register };
