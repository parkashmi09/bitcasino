'use strict';

const { EVENTS, AUDIENCE } = require('@ibitplay/socket');
const { money, vipLevelFor } = require('@ibitplay/common');
const errors = require('./profile.errors');
const { ProfileService } = require('./profile.service');
const { IN_HOUSE_GAMES } = require('./profile.constants');
/**
 * `EDIT_ACCOUNT` changes the address password reset delivers to, so it spends
 * a verified code. Issuance and proof both live in the email module.
 */
const { EmailService } = require('../email/email.service');
const { PURPOSE: EMAIL_PURPOSE } = require('../email/email.constants');

/**
 * The read events — profile, history, leaderboards, charts.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THREE OF THESE TOOK THE ACCOUNT FROM THE MESSAGE
 *
 *     client.on(C.USER_INFO, (data) => {
 *       let { id, coin, first, rate } = decode(data);   // ← shadows the
 *       ...                                             //   connection's id
 *       Rule.userInfo(id, coin, first, rate, (result) => {
 *
 * `C.USER_INFO`, `C.GAME_DETAILS` and `C.USER_CHART` all destructure `id` out
 * of the payload, shadowing the connection's own, and none of the three has an
 * `if (!id) return;`. So any client — signed in or not — could read any
 * player's profile, their game history and their betting chart by sending an
 * id. `USER_INFO` returns the balance in every currency the platform holds.
 *
 * Same shape as the HTTP findings — `user_id` from the body on bet placement,
 * `x-staff-id` from a header on the deposit reports — on a transport where it
 * was easier to miss, because the guard was a line to remember rather than
 * something the router attached.
 *
 * Nineteen of the forty-two handlers in `Users/index.js` have no guard at all.
 * Most are defensible (pre-login, or genuinely public data); these three are
 * not. See `docs/SOCKETS.md` §7.
 *
 * ── AND A LEADERBOARD IS NOT A CUSTOMER LIST ─────────────────────────────
 *
 * `Rule.topWinners` and `Rule.lastBets` are public by design — a casino shows
 * recent big wins. What they returned was the full row. Only the display
 * fields are selected here; the amounts stay, the identifiers do not.
 */

const ok = (payload) => ({ status: true, ...payload });
const refuse = (error) => ({ status: false, msg: error.message, error: { code: error.code } });

/** Newest-first, bounded. Legacy's leaderboards had no limit. */
const MAX_ROWS = 50;

function register({ on, deps }) {
  const { models, clients, logger } = deps;

  const profile = new ProfileService(deps);
  /**
   * The email module owns OTP issuance and proof. `EDIT_ACCOUNT` spends a
   * proof rather than reimplementing one — see `ProfileService.changeEmail`.
   */
  const emails = new EmailService(deps);

  const userOr404 = async (userId, attributes) => {
    const row = await models.Users.findOne({ where: { id: userId }, attributes, raw: true });
    if (!row) throw errors.NOT_FOUND({ userId });
    return row;
  };

  /**
   * @legacy SOCKET ca6e08ddde39ee9f965270b7d8175d17
   *
   * `C.EDIT_ACCOUNT` — change the username and/or the email address.
   *
   * ── WHAT LEGACY'S VERSION ALLOWED ────────────────────────────────────
   *
   *     client.on(C.EDIT_ACCOUNT, (data) => {
   *       let { email, username } = decode(data);
   *       if (!id) return;
   *       Rule.editAccount(id, email, username, ...)
   *
   * The guard is there, so the ACCOUNT was the caller's. What was not there is
   * any confirmation that the new email could receive mail, and the uniqueness
   * check was `result.length > 1` — off by one, so one existing account on that
   * address passed it and two accounts ended up sharing one. See
   * `ProfileService.changeEmail` for why that combination is an account
   * takeover rather than a data-quality problem.
   *
   * The username half goes through `ProfileService.update`, which has the
   * case-insensitive uniqueness check `PUT /editProfile` never had.
   */
  on(EVENTS.EDIT_ACCOUNT, {
    audience: AUDIENCE.USER,
    // Both halves write to `users`; neither is a thing anyone does often.
    limit: { windowMs: 60_000, max: 10 },
    handle: async (payload, context) => {
      const { username, email, code } = payload ?? {};

      if (username === undefined && email === undefined) {
        return { status: false, msg: 'Provide a username or an email address' };
      }

      try {
        let result;

        if (username !== undefined) {
          result = await profile.update(context.userId, { username: String(username) });
        }

        if (email !== undefined) {
          /**
           * The code is verified here, then the proof is spent inside
           * `changeEmail`. Two steps because verifying a code and spending the
           * verification are different acts — the same split the reset path
           * uses, and the reason one code cannot authorise two changes.
           */
          if (code !== undefined) {
            await emails.verifyOtp({
              email: String(email),
              code: String(code),
              purpose: EMAIL_PURPOSE.CHANGE_EMAIL,
            });
          }

          result = await profile.changeEmail(context.userId, {
            email: String(email),
            proveEmail: ({ email: address }) =>
              emails.spendProof({ email: address, purpose: EMAIL_PURPOSE.CHANGE_EMAIL }),
          });
        }

        return ok({ profile: result });
      } catch (error) {
        if (error.code?.startsWith('PROFILE_') || error.code?.startsWith('EMAIL_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 18566cda79f670c2098360799275aa31
   *
   * `C.USER_INFO` — the caller's own profile.
   *
   * The id comes from the token. Legacy read it from the message.
   */
  on(EVENTS.USER_INFO, {
    audience: AUDIENCE.USER,
    handle: async (_payload, context) => {
      try {
        const user = await userOr404(context.userId, [
          'id', 'name', 'email', 'avatar', 'level', 'games_played', 'country',
          'referalcode', 'created', 'last_login_at',
        ]);

        const [credits, wager] = await Promise.all([
          models.Credits.findOne({ where: { uid: user.id }, raw: true }),
          models.Userwager.findOne({ where: { uid: user.id }, raw: true }),
        ]);

        const lifetimeWager = String(wager?.wager ?? '0').replace(/,/g, '');

        return ok({
          uid: String(user.id),
          name: user.name,
          email: user.email ?? null,
          avatar: user.avatar ?? null,
          level: Number(user.level ?? 0),
          country: user.country ?? null,
          gamesPlayed: Number(user.games_played ?? 0),
          referralCode: user.referalcode ?? null,
          joined: user.created ?? null,
          lastLogin: user.last_login_at ?? null,
          wager: lifetimeWager,
          /**
           * The shared ladder — the same one the operator's reports use, so a
           * player and a support agent never see different levels.
           */
          vip: vipLevelFor(lifetimeWager),
          credit: describeBalances(credits),
        });
      } catch (error) {
        if (error.code?.startsWith('PROFILE_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 657cdcaf1b9072c7d708bb3766bd3915
   *
   * `C.GAME_DETAILS` — one of the caller's own bets.
   *
   * Legacy took the id from the message with no guard, so any bet could be
   * inspected by anyone. Scoped to the caller here.
   */
  on(EVENTS.GAME_DETAILS, {
    audience: AUDIENCE.USER,
    handle: async (payload, context) => {
      const betId = Number(payload?.id);
      if (!Number.isInteger(betId) || betId <= 0) return refuse(errors.NOT_FOUND({ id: payload?.id }));

      const { bet } = await clients.casino.get(
        `/internal/casino/bet-history/player/${context.userId}/bets/${betId}`
      );
      // One code for "no such bet" and "not yours" — otherwise the endpoint
      // confirms which bet ids exist.
      if (!bet) return refuse(errors.NOT_FOUND({ id: betId }));

      return ok({ bet });
    },
  });

  /**
   * @legacy SOCKET 1cf37d076d187195c2d7d5e3678dfe0b
   *
   * `C.USER_CHART` — the caller's profit over time.
   */
  on(EVENTS.USER_CHART, {
    audience: AUDIENCE.USER,
    handle: async (payload, context) => {
      const { game } = payload ?? {};
      return ok(
        await clients.casino.get(`/internal/casino/bet-history/player/${context.userId}/chart`, {
          query: game ? { game: String(game) } : {},
        })
      );
    },
  });

  /**
   * @legacy SOCKET fd2a0537bcdae1736f552707b3bd3156
   *
   * `C.MY_BETS`.
   */
  on(EVENTS.MY_BETS, {
    audience: AUDIENCE.USER,
    handle: async (payload, context) => {
      const { game, limit } = payload ?? {};
      return ok(
        await clients.casino.get(`/internal/casino/bet-history/player/${context.userId}/bets`, {
          query: { ...(game ? { game: String(game) } : {}), limit: Math.min(Number(limit) || 25, MAX_ROWS) },
        })
      );
    },
  });

  /**
   * @legacy SOCKET fd2a0537bcdae1736f552707b3bd3157
   *
   * `C.MY_HISTORY`.
   */
  on(EVENTS.MY_HISTORY, {
    audience: AUDIENCE.USER,
    handle: async (payload, context) => {
      const { limit } = payload ?? {};

      const rows = await models.CreditsLedger.findAll({
        where: { user_id: String(context.userId) },
        order: [['id', 'DESC']],
        limit: Math.min(Number(limit) || 25, MAX_ROWS),
        raw: true,
      });

      return ok({
        history: rows.map((row) => ({
          id: String(row.id),
          amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
          currency: row.currency,
          reason: row.reason,
          description: row.description ?? null,
          at: row.created_at,
        })),
      });
    },
  });

  /**
   * @legacy SOCKET fd2a0537bcdae1736f552707b3bd3160
   *
   * `C.inr_History`. The key is spelled that way in the constant table and is
   * left alone — it is what the clients send.
   */
  on(EVENTS.inr_History, {
    audience: AUDIENCE.USER,
    handle: async (payload, context) => {
      const user = await userOr404(context.userId, ['id', 'name']);

      const rows = await models.InrDeposit.findAll({
        // `inr_deposit` keys on the player's NAME, not their id — a legacy
        // shape this port cannot change without a data migration. Resolved
        // from the authenticated id so a caller cannot supply it.
        where: { name: user.name },
        order: [['date', 'DESC']],
        limit: Math.min(Number(payload?.limit) || 25, MAX_ROWS),
        raw: true,
      });

      return ok({
        history: rows.map((row) => ({
          date: row.date,
          amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
          status: row.status,
          transactionId: row.trxid ?? null,
        })),
      });
    },
  });

  /**
   * @legacy SOCKET f37bd2f66651e7d76f6d38770f2bc5dd
   *
   * `C.NOTIFICATION` — the platform's announcements. Genuinely public.
   */
  on(EVENTS.NOTIFICATION, {
    audience: AUDIENCE.PUBLIC,
    handle: async () => {
      /**
       * ORDERED BY `date`, BECAUSE THIS TABLE HAS NO `id`.
       *
       * `notifications` is one of the handful of baseline tables declared
       * with no primary key — `(title, content, date)` and nothing else —
       * and the model says so: it calls `removeAttribute('id')` to stop
       * Sequelize inventing one. Ordering by `id` therefore emitted
       * `ORDER BY "Notifications"."id" DESC` against a column that does
       * not exist, Postgres refused the statement, and this event answered
       * `SOCKET_HANDLER_FAILED` — every time, for every caller.
       *
       * Found by calling it. The web client's notification feed is the
       * first thing on this platform to send `C.NOTIFICATION`.
       */
      const rows = await models.Notifications.findAll({
        order: [['date', 'DESC']],
        limit: 20,
        raw: true,
      });
      return ok({ notifications: rows });
    },
  });

  /**
   * @legacy SOCKET b7cafd57089c07ade71b7776085660a0
   *
   * `C.TOP_WINNERS`.
   *
   * Public by design — a casino shows recent big wins. Legacy returned the
   * whole row; only the display fields are selected here.
   */
  on(EVENTS.TOP_WINNERS, {
    audience: AUDIENCE.PUBLIC,
    handle: async () => {
      return ok(await clients.casino.get('/internal/casino/bet-history/top-winners', { query: { limit: 20 } }));
    },
  });

  /**
   * @legacy SOCKET 62f8c260fbce6de8e5ed19767977cc1e
   *
   * `C.LAST_BETS`.
   */
  on(EVENTS.LAST_BETS, {
    audience: AUDIENCE.PUBLIC,
    handle: async () => {
      return ok(await clients.casino.get('/internal/casino/bet-history/recent', { query: { limit: MAX_ROWS } }));
    },
  });

  /**
   * @legacy SOCKET b87a2e8036f0617125ffb69dd5673d7b
   *
   * `C.LAST_BETS_BY_GAME`.
   */
  on(EVENTS.LAST_BETS_BY_GAME, {
    audience: AUDIENCE.PUBLIC,
    handle: async (payload) => {
      const game = String(payload?.game ?? '').trim();
      if (!game) return refuse(errors.NOT_FOUND({ game }));

      const result = await clients.casino.get('/internal/casino/bet-history/recent', {
        query: { game, limit: MAX_ROWS },
      });
      return ok({ game, ...result });
    },
  });

  /**
   * @legacy SOCKET f464cc8e884061eb09553186bdb2e9c1
   *
   * `C.GAMES` — the in-house game list. Public, as it was.
   */
  on(EVENTS.GAMES, {
    audience: AUDIENCE.PUBLIC,
    handle: async () => {
      /**
       * `Rule.getGamesList` is `return callback(games)` — a module-level
       * constant, not a query. There is no `games` table and never was.
       * The list lives in `IN_HOUSE_GAMES` for the same reason.
       */
      return ok({ games: IN_HOUSE_GAMES });
    },
  });

  /**
   * @legacy SOCKET 0c30c5a602062107a5d356d0eb1ebb8e
   *
   * `C.BANKROLL`.
   *
   * The legacy handler's body is entirely commented out:
   *
   *     client.on(C.BANKROLL, (data) => {
   *       // Rule.getBankRoll(game, coin, (result) => {
   *
   * so it accepted the message and answered nothing. Kept as a real read of
   * the `bankroll` table, which is what the name says and what the client
   * expects.
   */
  on(EVENTS.BANKROLL, {
    audience: AUDIENCE.PUBLIC,
    handle: async () => {
      /**
       * ─────────────────────────────────────────────────────────────────
       * THE `bankroll` TABLE DOES NOT EXIST
       *
       * Legacy's handler body is entirely commented out:
       *
       *     client.on(C.BANKROLL, (data) => {
       *       // Rule.getBankRoll(game, coin, (result) => {
       *
       * and `Rule.getBankRoll` queries `SELECT balance FROM bankroll`, a table
       * that is not in the schema. So the handler was commented out because
       * the thing behind it was gone, not by accident.
       *
       * Answered explicitly rather than left to time out. Reinstating it needs
       * a decision about what a per-game bankroll means on this platform,
       * which is a product question, not a port one.
       * ─────────────────────────────────────────────────────────────────
       */
      return ok({ bankroll: [], available: false });
    },
  });

  logger?.debug('Profile socket events registered');
}

/**
 * Balances, as decimal strings.
 *
 * Legacy returned the raw `credits` row — every column, at whatever precision
 * `pg.types.setTypeParser(1700, parseFloat)` had already turned it into.
 *
 * ── WHY `toMinorQuantised` AND NOT `toMinor` ────────────────────────────
 *
 * `credits` is bare `numeric`, so a column holds whatever arithmetic produced —
 * real rows carry twenty decimal places. `toMinor` REFUSES more than eight, by
 * design: it validates writes, where extra precision is a bug worth a 400.
 *
 * This is a read of a row that already exists. Using `toMinor` here threw
 * `BAD_REQUEST: amount supports at most 8 decimal places` out of `USER_INFO`
 * for any player holding one over-precise balance — and `USER_INFO` is the
 * whole profile, so the refusal took the name, the wager and the VIP level down
 * with it. The VIP card then rendered its "no data" placeholders (V0, 0.00 INR)
 * and the header showed no balance, with nothing in the console to say why.
 *
 * `money.js` names this exact case on `toMinorQuantised` itself: reads quantise,
 * writes reject.
 */
function describeBalances(credits) {
  if (!credits) return {};
  const out = {};
  for (const [key, value] of Object.entries(credits)) {
    if (key === 'uid') continue;
    out[key] = money.toDecimalString(money.toMinorQuantised(value ?? '0', { field: key }));
  }
  return out;
}



module.exports = { register };
