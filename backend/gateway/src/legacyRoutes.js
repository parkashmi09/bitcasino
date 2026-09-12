'use strict';

/**
 * Legacy path compatibility.
 *
 * 558 routes have live clients, and some of those clients are not ours: provider
 * callback URLs (`/api/seamless/*`, `/api/ccpaymentnotify`, `/callback_evo`) are
 * registered on the PROVIDER's side and cannot be changed without a support
 * ticket. Others are baked into shipped mobile builds.
 *
 * So the old path keeps working. This maps it onto the new one by REWRITING
 * `req.url` before routing — not by redirecting. A 3xx would break every one of
 * those callbacks, because payment providers POST and do not follow redirects.
 *
 * Each rewrite logs the old path at `info`. After a few weeks the logs answer
 * the only question that matters at retirement time: which legacy paths still
 * have traffic.
 *
 * This map grows one entry per ported route. It is intentionally explicit
 * rather than generated at runtime — a wrong rewrite silently sends money
 * somewhere unexpected, so each line should be readable and reviewable.
 */

/** `'<METHOD> <legacy path>': '<new path>'` — exact matches, checked first. */
const EXACT = {
  // ── user/wallet (was scattered across legacy/index.js) ──────────────
  'GET /getwallet': '/api/v1/user/wallet/balances',
  'POST /updatebalance': '/api/v1/admin/user/wallet/adjust',
  'POST /adminwalletadd': '/api/v1/admin/user/wallet/adjust',

  // ── user/auth ───────────────────────────────────────────────────────
  'POST /user/change-password': '/api/v1/user/auth/change-password',

  // ── user/profile (were inline in legacy/index.js, all unauthenticated) ──
  'PUT /editProfile': '/api/v1/user/profile',

  // ── user/2fa ────────────────────────────────────────────────────────
  'POST /2fa/enable': '/api/v1/user/2fa/enable',
  'POST /2fa/setup-verify': '/api/v1/user/2fa/setup-verify',
  'POST /2fa/verify': '/api/v1/user/2fa/verify',
  'POST /2fa/disable': '/api/v1/user/2fa/disable',

  // ── user/kyc ────────────────────────────────────────────────────────
  'POST /kyc/submit': '/api/v1/user/kyc/submit',
  'PUT /kyc/update-status': '/api/v1/admin/user/kyc/review',
  'GET /kyc/admin/applications': '/api/v1/admin/user/kyc/applications',

  // ── user/swap ───────────────────────────────────────────────────────
  'GET /internalswap/estimate': '/api/v1/user/swap/estimate',
  'POST /internalswap/swap': '/api/v1/user/swap',
  'GET /internalswap/history': '/api/v1/admin/user/swap/history',

  // ── user/exchange-rate ──────────────────────────────────────────────
  'GET /exchangeRate/rates': '/api/v1/user/exchange-rate/rates',
  'GET /exchangeRate/convert': '/api/v1/user/exchange-rate/convert',
  'POST /exchangeRate/rates': '/api/v1/admin/user/exchange-rate/rates',

  // ── user/deposits (fiat) — legacy read these from the WRONG table ────
  'POST /api/deposits/create': '/api/v1/user/deposits/fiat',
  'GET /api/deposits/user-deposits': '/api/v1/user/deposits/fiat',
  'GET /api/deposits/admin/all-deposits': '/api/v1/admin/user/deposits/fiat',
  'GET /api/deposits/admin/pending-deposits': '/api/v1/admin/user/deposits/fiat/pending',

  // ── user/withdrawals (fiat) ─────────────────────────────────────────
  'POST /createFiatWithdrawal': '/api/v1/user/withdrawals/fiat',
  'GET /getFiatWithdrawData': '/api/v1/admin/user/withdrawals/fiat',
  'POST /updateFiatWithdrawStatus': '/api/v1/admin/user/withdrawals/fiat/status',

  // ── user/vault ──────────────────────────────────────────────────────
  'GET /vaultpro/lock-options': '/api/v1/user/vault/lock-options',
  'POST /vaultpro/transfer-in': '/api/v1/user/vault/transfer-in',
  'POST /vaultpro/transfer-out': '/api/v1/user/vault/transfer-out',
  'GET /vaultpro/admin/vault/users': '/api/v1/admin/user/vault/users',
  'GET /vaultpro/admin/vault/stats': '/api/v1/admin/user/vault/stats',

  // ── user/p2p — peer-to-peer trading ─────────────────────────────────
  //
  // NEVER MOUNTED, AND NOT ONE OF ITS 21 ROUTES HAD A MIDDLEWARE. Thirteen
  // were under `/admin/p2p/`, including three that move real money:
  // release credits crypto, sell-cancel refunds it (repeatedly — it checked
  // only for RELEASED, so cancelling a CANCELLED order refunded again), and
  // sell-release completes a fiat payout. `order.coin` was interpolated into
  // `UPDATE credits SET ${coin}` as a column name, from a request body.
  //
  // The two order-creating routes read `user_id` from the BODY, and a SELL
  // order debits the named account immediately.
  'GET /p2p/offers': '/api/v1/user/p2p/offers',
  'POST /p2p/create-order': '/api/v1/user/p2p/orders',
  'POST /p2p/create-sell-order': '/api/v1/user/p2p/sell-orders',
  'POST /p2p/dispute': '/api/v1/user/p2p/disputes',
  'GET /admin/p2p/payment-types': '/api/v1/admin/user/p2p/payment-types',
  'POST /admin/p2p/payment-type': '/api/v1/admin/user/p2p/payment-types',
  'GET /admin/p2p/payment-accounts': '/api/v1/admin/user/p2p/payment-accounts',
  'POST /admin/p2p/payment-account': '/api/v1/admin/user/p2p/payment-accounts',
  'GET /admin/p2p/offers': '/api/v1/admin/user/p2p/offers',
  'POST /admin/p2p/create-offer': '/api/v1/admin/user/p2p/offers',
  'GET /admin/p2p/orders': '/api/v1/admin/user/p2p/orders',
  'GET /admin/p2p/sell-orders': '/api/v1/admin/user/p2p/sell-orders',
  'GET /admin/p2p/disputes': '/api/v1/admin/user/p2p/disputes',
  //
  // The per-order routes carry their id in a path segment the EXACT map cannot
  // express. They are:
  //   GET   /p2p/orders/:userId          → GET /api/v1/user/p2p/orders (token)
  //   GET   /p2p/sell-orders/:userId     → GET /api/v1/user/p2p/sell-orders
  //   GET   /p2p/order/:orderId          → GET /api/v1/user/p2p/order/:orderId
  //   POST  /p2p/mark-paid/:orderId      → POST …/user/p2p/orders/:orderId/paid
  //   POST  /admin/p2p/release/:id       → POST …/p2p/orders/:orderId/release
  //   POST  /admin/p2p/cancel/:id        → POST …/p2p/orders/:orderId/cancel
  //   PUT   /admin/p2p/order/:id/status  → PATCH …/p2p/orders/:orderId/status
  //   POST  /admin/p2p/sell-release/:id  → POST …/sell-orders/:orderId/release
  //   POST  /admin/p2p/sell-cancel/:id   → POST …/sell-orders/:orderId/cancel
  //   PUT   /admin/p2p/dispute/:id/status → PATCH …/disputes/:disputeId/status
  //
  // NOT MAPPED: `DELETE /admin/p2p/order/:orderId`. It ran a bare DELETE with
  // no status check and no authentication — removing a RELEASED order destroys
  // the only record that crypto was paid out, while the wallet ledger row
  // survives with nothing to reconcile against. Cancelling refunds correctly.

  // ── user/history ────────────────────────────────────────────────────
  'GET /depositHistory/crypto/deposits': '/api/v1/admin/user/history/crypto/deposits',
  'GET /depositHistory/fiat/deposits': '/api/v1/admin/user/history/fiat/deposits',

  // ── user/psp — provider callbacks. These paths are registered on the
  //    PROVIDER's side and cannot be changed without a support request.
  'POST /webhook/paymentstatuspui': '/api/v1/user/psp/upi/callback',
  'POST /remotes/webhook': '/api/v1/user/psp/apay/callback',
  'POST /cricpay/payment-callback': '/api/v1/user/psp/cricpay/callback',
  'POST /api/payments/payin/callback': '/api/v1/user/psp/waypay/callback',
  'POST /api/payments/payout/callback': '/api/v1/user/psp/waypay/payout-callback',
  'POST /remotes/withdrawal-webhook': '/api/v1/user/psp/apay/payout-callback',

  // ── user/payment-orders — STARTING a payment ────────────────────────
  //
  // These are NOT drop-in rewrites. Every one of the legacy versions took the
  // user id from the request body and none was authenticated, so the new
  // endpoint takes the id from the token instead and rejects a body that
  // carries one. A client calling the old path must be updated to send a
  // bearer token and drop the id — the rewrite gets it to the right handler,
  // it does not make the old request shape work.
  //
  // The three payout paths below are the ones worth reading twice:
  // `/remotes/create-withdrawal` debited whichever user the body named and
  // paid out to whichever bank account it named.
  'POST /remotes/create-deposit': '/api/v1/user/payments/deposits',
  'POST /cricpay/payment-request': '/api/v1/user/payments/deposits',
  'POST /api/payments/payin/initiate': '/api/v1/user/payments/deposits',
  'POST /create-order': '/api/v1/user/payments/deposits',

  'POST /remotes/create-withdrawal': '/api/v1/user/payments/withdrawals',
  'POST /cricpay/payout-request': '/api/v1/user/payments/withdrawals',
  'POST /api/payments/payout/initiate': '/api/v1/user/payments/withdrawals',

  /**
   * The two remaining outbound order entry points.
   *
   * `/createorderupi` is the EkQR (UPI) collect flow and `/createDeposit` is
   * CCPayment's crypto deposit address — a fifth provider, wired into the same
   * service as the other four.
   *
   * Neither is a drop-in: both named the player in the body (`uid` / `userid`)
   * on an unauthenticated route, and `/createDeposit` also let the caller pick
   * `orderId` — the key the confirmation callback resolves a payment against.
   * A client on these paths must send a bearer token and drop both fields.
   */
  'POST /createorderupi': '/api/v1/user/payments/deposits',
  'POST /createDeposit': '/api/v1/user/payments/deposits',

  /**
   * NOT rewritten: `POST /checkorderstatusupi` and `POST /getOrder`.
   *
   * Both were unauthenticated proxies — a transaction id in the body, the
   * provider's raw answer back, for anybody's payment. The replacement is
   * `POST /payments/orders/:provider/:reference/refresh`, which needs the
   * provider name and the reference in the PATH and scopes the lookup to the
   * caller's own order first.
   *
   * A rewrite cannot supply the provider segment, and guessing it would send a
   * UPI reference to CCPayment. These 404 at the old path.
   */

  'GET /cricpay/check-payment-status': '/api/v1/user/payments/methods/cricpay',
  'POST /api/payments/utr/repair': '/api/v1/admin/user/payments/utr-repair',

  // ── user/withdrawals (crypto) — the review queue ────────────────────
  //
  // `POST /updateWithdrawStatus` was `UPDATE withdrawals SET status = $1 WHERE
  // id = $2`, unauthenticated, with no state machine and no refund. The
  // replacement puts the id in the path, so the rewrite below cannot express
  // it and it is deliberately absent — a client must move to
  // `POST /withdrawals/crypto/:id/decision` and send a status from the enum.
  'GET /getWithdrawData': '/api/v1/admin/user/withdrawals/crypto',
  'GET /withdrawals': '/api/v1/admin/user/withdrawals/crypto',

  // `GET /api/withdrawNew` read THREE tables — `withdrawals`,
  // `fiat_withdrawals` and `apaywithdrawals`. It pointed at the crypto queue
  // alone, so a client following the rewrite lost every fiat and A-Pay payout
  // the player had made. `/history/withdrawals` is the one that reads all three.
  'GET /api/withdrawNew': '/api/v1/user/history/withdrawals',

  // ── user/history (crypto deposits) ──────────────────────────────────
  //
  // `GET /deposits` was `SELECT * FROM deposits` — every deposit on the
  // platform, unauthenticated and unpaged.
  'GET /deposits': '/api/v1/admin/user/history/deposits',
  'GET /getDepositData': '/api/v1/admin/user/history/deposits',
  // `GET /api/depositNew` read FOUR deposit tables. `/history` answers with
  // deposits AND withdrawals wrapped in an object; `/history/deposits` is the
  // list, on every rail, which is what the old path returned.
  'GET /api/depositNew': '/api/v1/user/history/deposits',

  // `GET /getWithdrawDataUser?uid=` named the player in the query string. The
  // replacement takes the player from the token.
  'GET /getWithdrawDataUser': '/api/v1/user/withdrawals/crypto',

  // ── sports/feed — the odds board ─────────────────────────────────────
  //
  // Every one of these went through a BullMQ queue and blocked on
  // `job.waitUntilFinished()` with no timeout. They are in-process reads now,
  // against a cached and timeout-bounded feed client.
  //
  // The feed itself was read over `http://46.202.164.63:6565/api` — cleartext,
  // to a bare IP, carrying match RESULTS.
  'GET /sports/allinplay': '/api/v1/sports/feed/inplay/all',
  'GET /sports/all-matches': '/api/v1/sports/feed/matches',
  'GET /sports/getSeries': '/api/v1/sports/feed/series',
  'GET /sports/getMatchesBySportsID': '/api/v1/sports/feed/events',
  'GET /sports/getMatchesBySportsIDSeriesID': '/api/v1/sports/feed/events/by-series',
  'GET /sports/allSportsID': '/api/v1/sports/feed/sports',
  'GET /sports/market-ids-v1': '/api/v1/sports/feed/markets/ids',
  'GET /sports/market-ids-v2': '/api/v1/sports/feed/markets/ids/v2',
  'GET /sports/market-odds': '/api/v1/sports/feed/markets/odds',
  'GET /sports/bookmakerFancy': '/api/v1/sports/feed/markets/fancy',
  'GET /sports/lineMarket': '/api/v1/sports/feed/markets/line',
  'GET /sports/marketDetails': '/api/v1/sports/feed/markets/details',
  'GET /sports/eventList': '/api/v1/sports/feed/events/list',
  'GET /sports/event-details': '/api/v1/sports/feed/events/details',
  'GET /sports/event-result': '/api/v1/sports/feed/results/event',
  'GET /sports/event-list-result': '/api/v1/sports/feed/results/list',
  // The same two controllers were ALSO mounted at the root, without even the
  // sports-enabled check their `/sports` twins had.
  'GET /event-result': '/api/v1/sports/feed/results/event',
  'GET /event-list-result': '/api/v1/sports/feed/results/list',
  /**
   * NOT rewritten: `POST /sports/inplay`.
   *
   * It reads nothing and writes nothing — the optional `gameId` was in the
   * request BODY, which is the only reason it was a POST. The replacement is
   * `GET /feed/inplay?gameId=`, and a rewrite cannot turn a POST body into a
   * query string. The client changes verb.
   *
   * NOT rewritten either: `GET /sports/inplayGameId/:gameId`,
   * `GET /sports/matches/:gameId`, `GET /sports/matches-by-date/:dateType` and
   * `GET /sports/matches/:dateType/:gameId`. The gateway's EXACT map is keyed
   * on a literal path and these all carry a parameter segment; the prefix rules
   * below cover the ones that can be covered.
   */

  // ── admin/deposit — a SECOND manual-deposit surface, unauthenticated ──
  //
  // `legacy/system/deposit/` served `/api/deposit/*` — singular — over the same
  // `fiat_deposits` table as `/api/deposits/*`. Every other route file under
  // `legacy/system/` begins with `router.use(protectStaff)`; that one has no
  // middleware at all, and its approve handler takes the approver from an
  // `x-staff-id` REQUEST HEADER. `x-staff-id: 1` approved any pending deposit
  // and credited the player.
  //
  // Both paths now land on the one authenticated implementation.
  'POST /api/deposit/create': '/api/v1/user/deposits/fiat',
  'GET /api/deposit/admin/pending': '/api/v1/admin/user/deposits/fiat/pending',

  /**
   * NOT rewritten: the approve, reject and screenshot routes, and
   * `/user/history/:username`.
   *
   * All four carry a parameter segment, which the gateway's EXACT map cannot
   * express. The replacements are under `/api/v1/admin/user/deposits/fiat/`
   * and require a staff token — a rewrite would only move the 401 to a
   * different path.
   *
   * `POST /api/deposit/user-pl` and `POST /api/deposit/staff-pl` are also
   * absent: both were POSTs carrying the id in the body, and both are reads.
   * They are now
   * `GET /api/v1/admin/user/reports/deposits/profit-loss/{user,staff}/:id`.
   */

  // ── admin/auth — staff sign-in ───────────────────────────────────────
  //
  // The legacy handler's second line was
  // `console.log('Login attempt with password:', password)` — every staff
  // password, in cleartext, in the application log. It also answered
  // 'Bad email' and 'Bad password' separately and skipped the bcrypt compare
  // on the first, so it enumerated accounts by body AND by timing, with no
  // attempt limit of any kind.
  'POST /api/staff/auth/login': '/api/v1/admin/auth/login',
  'POST /api/staff/auth/executive/login': '/api/v1/admin/auth/executive/login',
  'POST /api/staff/auth/first-login-password': '/api/v1/admin/auth/first-login-password',
  'POST /api/staff/auth/logout': '/api/v1/admin/auth/logout',

  // ── user/crypto — deposits arriving ──────────────────────────────────
  //
  // `POST /api/ccpaymentnotify` built its credit statement as
  // `UPDATE credits SET ${coinSymbol.toLowerCase()} = ... + $1` with the symbol
  // taken from the webhook body. The amount was parameterised; the COLUMN NAME
  // was not. The signature check in front of it is verified against a secret
  // hardcoded in `legacy/index.js`.
  'POST /api/ccpaymentnotify': '/api/v1/user/crypto/ccpayment/callback',
  'GET /getAllChains': '/api/v1/user/crypto/chains',
  // Two endpoints for one question: `/rate` served a process-local cache that
  // a second instance would not share.
  'GET /rate': '/api/v1/user/exchange-rate/rates',

  /**
   * NOT rewritten: `POST /getCoinDetails` and `POST /inrhistory`.
   *
   * Both were POSTs whose only parameter was in the body, and both are reads.
   * `getCoinDetails` is `GET /crypto/coins?symbol=`; `inrhistory` took a `name`
   * on an unauthenticated route and is now `GET /crypto/inr-history` behind a
   * token, keyed on the caller. A rewrite cannot change the verb or move a body
   * into a query string.
   *
   * NOT rewritten either — and NOT PORTED:
   *
   *     GET /walletNotify      GET /blockNotify      GET /crypto_callbacks
   *
   * Three node callbacks that take their whole payload from a raw query
   * string, pass it to a Socket.io-coupled updater and answer `*ok*`, with no
   * authentication or signature of any kind. They belong to a wallet daemon
   * this port has no visibility into, and their handlers write balances through
   * a socket layer whose ownership is still open. Reproducing an
   * unauthenticated balance write against a component nobody can currently test
   * would be worse than leaving them; see the note in
   * `services/user/src/modules/crypto/routes/public.routes.js`.
   */

  // ── admin/notifications — push ───────────────────────────────────────
  //
  // `POST /firebase/send-bulk` had NO middleware: anyone reaching the port
  // could push a message of their own writing to every registered device on
  // the platform, from the operator's own app. `GET /allToken` handed out every
  // FCM token, which is enough to push to those devices through Firebase
  // directly.
  //
  // And five of the seven routes never worked — `user_notifications` was
  // referenced five times and created by nothing (migration 026).
  'GET /firebase/allToken': '/api/v1/admin/notifications/devices',
  'POST /firebase/send-to-user': '/api/v1/admin/notifications/send',
  'POST /firebase/send-bulk': '/api/v1/admin/notifications/broadcast',

  /**
   * NOT rewritten: `POST /firebase/register`, `POST /firebase/mark-as-read`,
   * and the two `/:userId` reads.
   *
   * The first two are PLAYER actions that legacy took a `userId` for in the
   * body with no authentication — so anyone could register a device against
   * anyone's account, or mark somebody else's alerts read. They move to
   * user-service, which takes the player from their token; the two reads carry
   * a parameter segment the EXACT map cannot express.
   */

  // ── casino/x-casino — the XGaming / GamingHub360 aggregator ──────────
  //
  // THE SIGNATURE DID NOT COVER THE PAYLOAD. `sha1(command + timestamp +
  // SECRET)` — and `data`, where `user_id`, `amount` and `transaction_type`
  // live, was not in it. One captured callback authenticated any body with the
  // same command: keep the three signed fields, replace `data`, credit any
  // account any amount. The timestamp was never checked against a clock
  // either, so a capture never expired.
  //
  // And the wallet column came from an unauthenticated request body:
  // `/api/casino/gamerun` took `user_id` and `coin` off the body with no
  // middleware, stored `coin` in `game_runs`, and changebalance interpolated it
  // into `UPDATE credits SET ${coin} = $1`.
  //
  // `transactionscasino` — the table all six callbacks read and wrote — was
  // never created (migration 028), and the INSERT ran AFTER the balance had
  // already moved, so the money went and the provider got a 500 it then retried.
  'POST /api/casino/authenticate': '/api/v1/casino/x-casino/authenticate',
  'POST /api/casino/balance': '/api/v1/casino/x-casino/balance',
  'POST /api/casino/changebalance': '/api/v1/casino/x-casino/changebalance',
  'POST /api/casino/status': '/api/v1/casino/x-casino/status',
  'POST /api/casino/cancel': '/api/v1/casino/x-casino/cancel',
  'POST /api/casino/gamerun': '/api/v1/casino/x-casino/launch',
  'GET /api/casino/casino-balance': '/api/v1/casino/x-casino/balance',

  // ── casino/catalogue — the lobby ─────────────────────────────────────
  //
  // Every upstream credential was in the source (`agent_code: "Skyla_USD"`,
  // `agent_token: "83eb5e…"`, `SECREATEkEYCASINO = 'Hja934U1nz'`), the
  // catalogue was fetched upstream on EVERY request with no cache, and the
  // aggregator's own errors were forwarded verbatim — and those errors quote
  // the request back, agent token included.
  'GET /api/games/list': '/api/v1/casino/catalogue/games',
  'GET /api/casino/vendors': '/api/v1/casino/catalogue/hub/vendors',
  'GET /api/casino/games/list': '/api/v1/casino/catalogue/hub/games',
  'GET /api/casino/games/lists': '/api/v1/casino/catalogue/hub/featured',
  'GET /api/casino/jackpots': '/api/v1/casino/catalogue/jackpots',
  'GET /game-list': '/api/v1/casino/catalogue/nexus/games',
  'GET /game-list-new': '/api/v1/casino/catalogue/nexus/games',
  // `/game_launch` and `/game_launch_new` took `user_code` from the body on
  // routes with no middleware — a session against any account.
  'POST /game_launch': '/api/v1/casino/catalogue/launch',
  'POST /game_launch_new': '/api/v1/casino/catalogue/launch',
  'POST /update-image': '/api/v1/admin/casino/catalogue/images/sync',
  'POST /update-gis-images-run-all': '/api/v1/admin/casino/catalogue/images/sync',

  // ── casino/house — the display counters ──────────────────────────────
  //
  // All six were unauthenticated and four of them WROTE, over GET. `/win-house`
  // and `/reset-house` are `UPDATE house SET …` with NO WHERE CLAUSE — every
  // row in the table — and `/start-house` leaked a cron job on every call
  // because `task` was overwritten rather than replaced.
  //
  // CORRECTION to what this comment said when the casino batch landed: `house`
  // is NOT a display table. `Users/Rule.js:2314` reads it on every bet in
  // sixteen games, and when `current >= max` a winning roll is discarded and
  // replaced with a losing number — while the hash of the DISCARDED roll is
  // published. `/win-house` sets `max = 0, current = 0` for every player at
  // once, so nobody can win. See docs/SOCKETS.md §2.
  'GET /gethouse': '/api/v1/admin/casino/house/',
  'POST /updatehouse': '/api/v1/admin/casino/house/',
  //
  // `/reset-house`, `/win-house`, `/start-house` and `/stop-house` are NOT
  // rewritten, and cannot be: all four are GET requests that WRITE, and the
  // replacements are POSTs. A rewrite that turned one into the other would
  // preserve exactly the property that made them dangerous — a URL that
  // mutates when a browser prefetches it or a crawler follows it.
  //
  // They are `POST /api/v1/admin/casino/house/bulk` with `{preset}` and
  // `POST /api/v1/admin/casino/house/ticker` with `{running}`. A client using
  // the old GETs has to change; that is the point.
  'GET /hour': '/api/v1/admin/casino/house/clock',

  // ── casino/bet-history — the raw tables ──────────────────────────────
  //
  // `GET /bets` was `SELECT * FROM bets` with no auth, no scope and no page:
  // every bet ever placed by every player in one response. The `/betHistory`
  // router scoped itself from `req.headers['x-staff-id']` — and when the
  // header was ABSENT the filter never applied at all.
  'GET /bets': '/api/v1/admin/casino/bet-history/house/bets',
  'GET /bet2': '/api/v1/admin/casino/bet-history/house/bets_2m',
  'GET /transaction/live': '/api/v1/admin/casino/bet-history/transactions/raw/live',
  'GET /transaction/slot': '/api/v1/admin/casino/bet-history/transactions/raw/slot',
  'GET /betHistory/transactions/luckysports': '/api/v1/admin/casino/bet-history/luckysports',
  // The two `/betHistory` SPORTS routes read `"SportsBet"`, which sports-service
  // owns — they are `/api/v1/sports/bet-admin/bets`, alongside the five other
  // routes over the same table.

  // ── user/crypto — the INR deposit record ─────────────────────────────
  //
  // `POST /hr` took the account, amount and status from an unauthenticated
  // body with `Access-Control-Allow-Origin: *`, and `inr_deposit` is the list
  // an operator approves manual deposits from.
  'POST /hr': '/api/v1/admin/user/crypto/inr-deposits',

  // ── admin/banners — the images on the front of the site ──────────────
  //
  // BOTH UPLOAD ROUTES WERE UNAUTHENTICATED. `POST /createBanner` and
  // `POST /updateBanner` had no middleware on a router mounted at
  // `/api/banners`: anyone reaching the port could write a file to the API
  // server's disk and replace the platform's home-page hero. The extension
  // filter read `file.originalname` — the client's own claim — and the bytes
  // were never looked at.
  //
  // Both legacy paths map to one route, because they were one operation with
  // two disagreeing implementations: create INSERTed a duplicate row, update
  // rewrote EVERY row of the type after unlinking one file. Migration 027
  // collapses the pile and moves the bytes into the row, because local disk is
  // not shared between replicas.
  'POST /api/banners/createBanner': '/api/v1/admin/banners',
  'POST /api/banners/updateBanner': '/api/v1/admin/banners',
  'GET /api/banners/getBannerAll': '/api/v1/admin/banners',
  'GET /api/banners/getAllImagesBinary': '/api/v1/admin/banners/binary',
  // `GET /api/banners/banner/:type` and `/image/:filename` carry a parameter
  // segment the EXACT map cannot express; they are `/api/v1/admin/banners/:type`
  // and `/api/v1/admin/banners/image/:filename`.

  // ── admin/blogs — the site's content pages ───────────────────────────
  //
  // NEVER MOUNTED, AND ALL FIVE WRITE ROUTES WERE UNAUTHENTICATED. The upload
  // took its MIME type from the client's declared Content-Type and its stored
  // filename extension from the client's own filename, into a statically-served
  // directory — so `Content-Type: image/png` over a file named `x.html` was
  // stored XSS on the platform's origin, by unauthenticated POST.
  //
  // The reads are mapped; the writes are mapped to routes that now need
  // `config:write`, so a client calling them must present a staff token.
  'GET /all': '/api/v1/admin/blogs',
  'POST /createBlog': '/api/v1/admin/blogs',
  //
  // NOT MAPPED: `POST /uploadImage`. It wrote bytes to a public directory with
  // no row pointing at them, so an orphan could never be found or cleaned up.
  // An image is a field on a post now — send it with create or update.
  //
  // `GET /by-id`, `/by-slug`, `/by-category`, `POST /updateBlog`,
  // `/deleteBlog` and `/deleteBlogById` all carried their key in a query string
  // or body that the EXACT map cannot express. They are, in order:
  //   GET    /api/v1/admin/blogs/:id
  //   GET    /api/v1/admin/blogs/slug/:slug
  //   GET    /api/v1/admin/blogs/category/:category
  //   PATCH  /api/v1/admin/blogs/:id
  //   DELETE /api/v1/admin/blogs/slug/:slug
  //   DELETE /api/v1/admin/blogs/:id

  // ── admin/reports — the customer directory and the export ────────────
  //
  // THE WHOLE `/reports` ROUTER WAS UNAUTHENTICATED. `server.use('/reports',
  // reportRoutes)` with no middleware anywhere in the router, on three routes
  // that read the customer database. `GET /reports/export` returned a CSV of
  // every direct player — id, name, referral code and balance — to anyone who
  // asked, and escaped quotes but not the `=`/`+`/`-`/`@` that make a
  // spreadsheet cell a formula.
  'GET /reports/users': '/api/v1/admin/reports/players',
  'GET /reports/export': '/api/v1/admin/reports/players/export',
  // `/reports/user/:userId` is `/api/v1/admin/reports/players/:userId`;
  // `/api/admin/balance-sheet/:userId` is `/api/v1/admin/reports/balance-sheet/:userId`;
  // `/api/report/player/:uid` is `/api/v1/admin/reports/player-sheet/:uid`.
  //
  // `/api/admin/agent-users` lived in `siteconfig/routes/adminRiskRoutes.js`
  // and was missed by the port entirely — there was no target to rewrite it to
  // until the reports module grew one, so the Agent System tab 404'd rather
  // than merely changing shape.
  'GET /api/admin/agent-users': '/api/v1/admin/reports/agent-users',
  //
  // `POST /api/admin/user-lock` is NOT here. The locks module already owns that
  // write at `POST /api/v1/admin/locks`, it reaches the whole subtree where
  // legacy reached one level, and its body names the locks rather than the
  // columns. A rewrite would have to translate the body, which is the caller's
  // job — see `LEGACY_FIELD_ALIASES`, which the validator already accepts.
  // `/api/admin/user-risk/:userId` carries a parameter and lives in PATTERNS.

  // ── admin/statements — the "hisab", on screen and in print ───────────
  //
  // Every path here carries a parameter segment, so none can be expressed in
  // the EXACT map. `/api/admin/agent-report/:staffId/statement` is
  // `/api/v1/admin/statements/:staffId/statement`, and so on for `/bets`,
  // `/pdf` and the three `user/:userId` variants. The bare
  // `/api/admin/agent-report/:staffId` is `/api/v1/admin/statements/:staffId`.
  //
  // Legacy served two DIFFERENT PDFs on `/:staffId` and `/:staffId/pdf`, built
  // from different queries — and a third renderer for the player report, whose
  // sports P&L came from the bet rows while the statement's came from
  // `credits_ledger`. Those disagree on any voided or manually adjusted bet, so
  // the platform could print two profit figures for one player and say nothing
  // about which to believe. One renderer now, over the payload the JSON
  // endpoints return.

  // ── admin/dashboard — headline figures ───────────────────────────────
  //
  // SIX OF THE NINE WERE UNAUTHENTICATED, including two that returned every
  // column of every deposit and withdrawal made today. `/today-transactions`
  // has additionally NEVER WORKED: it calls `pool.query`, and `pool` is
  // declared nowhere in `index.js` — the file uses `pg`.
  'GET /api/admin/dashboard': '/api/v1/admin/dashboard',
  'GET /api/admin/user-stats': '/api/v1/admin/dashboard/user-stats',
  'GET /today-deposits': '/api/v1/admin/dashboard/today?kind=deposits',
  'GET /today-withdrawals': '/api/v1/admin/dashboard/today?kind=withdrawals',
  'GET /today-transactions': '/api/v1/admin/dashboard/today',
  'GET /total-deposits': '/api/v1/admin/dashboard/totals?kind=deposits',
  'GET /total-withdrawals': '/api/v1/admin/dashboard/totals?kind=withdrawals',
  // `/api/members/:uid` is `/api/v1/admin/dashboard/members/:userId`.

  // ── admin/marketing — read-only acquisition analytics ────────────────
  //
  // One of the two well-written corners of the legacy repository, and carried
  // over largely intact: the read-only guarantee is enforced by refusing any
  // verb but GET before a handler runs, and the account type is re-read from
  // the database rather than trusted from a JWT claim.
  'GET /marketing/me': '/api/v1/admin/marketing/me',
  'GET /marketing/analytics/signups': '/api/v1/admin/marketing/analytics/signups',
  'GET /marketing/analytics/deposits': '/api/v1/admin/marketing/analytics/deposits',
  'GET /marketing/analytics/retention': '/api/v1/admin/marketing/analytics/retention',
  'GET /marketing/analytics/top-agents': '/api/v1/admin/marketing/analytics/top-agents',
  'GET /marketing/customers': '/api/v1/admin/marketing/customers',

  // ── admin/players — creating and closing a player account ────────────
  //
  // `DELETE /api/staff/players/:id` read `information_schema.columns` for
  // anything named `user_id`/`userid`/`uid`/`id_user`/`user` and DELETEd from
  // every one — every deposit, withdrawal, bet and ledger row the player ever
  // produced, unrecoverably, on a licensed gambling platform. It now closes and
  // anonymises the account and keeps the financial record.
  //
  // `POST` and the two `/:id` routes carry parameter segments except the
  // create: `/api/v1/admin/players`, then `/api/v1/admin/players/:playerId`.
  'POST /api/staff/players': '/api/v1/admin/players',

  // ── admin/locks — locking an account out ─────────────────────────────
  //
  // Two of the three lock fields legacy accepted name columns that DO NOT
  // EXIST (`all_system_blocked`, `casino_blocked`), and all three went into one
  // statement — so a request setting the sports lock alongside either of the
  // others failed entirely. Locking an agent also reached only their direct
  // children, leaving the branch below still trading, and the handler ignored
  // the row count and reported success either way.
  'POST /locksystem/update-system-lock': '/api/v1/admin/locks',
  // `GET /api/public/ref/:slug` is `/api/v1/admin/locks/ref/:slug` — genuinely
  // public, now rate-limited. `GET /api/public/user-transfers/:uid` is NOT
  // public: it returned any player's full transfer history, with amounts and
  // counterparty names, to anyone who could count. It is
  // `/api/v1/admin/locks/transfers/:userId` behind `reports:read`.

  // ── admin/accounts — operator controls over one account ──────────────
  //
  // The best-guarded code in the platform: `protectStaff`, a TRANSACTION
  // PASSWORD on every write, hierarchy checks, and `FOR UPDATE` before every
  // balance change. Two things were still wrong — the password reset wrote the
  // plaintext to `password2` for BOTH staff and players, and `BEGIN` was on the
  // one shared `pg.Client`, so the `FOR UPDATE` locks were held on behalf of
  // every concurrent request.
  'POST /lords/user-setting/update-password': '/api/v1/admin/accounts/password',
  'POST /lords/user-setting/status': '/api/v1/admin/accounts/status',
  'POST /lords/user-setting/exposure-limit': '/api/v1/admin/accounts/exposure-limit',
  'POST /lords/update-current': '/api/v1/admin/accounts/credit-limit',
  'POST /lords/quick-refill': '/api/v1/admin/accounts/refill',
  'POST /lords/funds/transfer': '/api/v1/admin/accounts/refill',
  'POST /funds/transfer': '/api/v1/admin/accounts/refill',
  'GET /lords/transfer/statement': '/api/v1/admin/accounts/statement',
  'GET /lords/users/all-details': '/api/v1/admin/accounts',
  'GET /lords/net-exposure/sports': '/api/v1/admin/accounts/exposure/sports',

  // ── admin/site-config — outbound mail ────────────────────────────────
  'GET /email/settings': '/api/v1/admin/site-config/email',
  'PUT /email/settings': '/api/v1/admin/site-config/email',
  'POST /email/settings/test': '/api/v1/admin/site-config/email/test',

  // ── admin/access — sub-logins and their authority ────────────────────
  //
  // The permission payload was validated for SHAPE and never compared to what
  // the creating staff member holds, so a grant could exceed its creator's own
  // authority. `resolvePermissions` trimmed it at login, but the oversized
  // grant was stored — so a later promotion of the parent silently promoted
  // every executive beneath them.
  'GET /lords/access/me/permissions': '/api/v1/admin/access/me/permissions',
  'GET /lords/access/executives': '/api/v1/admin/access/executives',
  'POST /lords/access/executives': '/api/v1/admin/access/executives',
  'GET /lords/access/marketing-users': '/api/v1/admin/access/marketing-users',
  'POST /lords/access/marketing-users': '/api/v1/admin/access/marketing-users',
  'GET /lords/access/activity': '/api/v1/admin/access/activity',
  /**
   * NOT rewritten: the four `/:id/lock` and `/:id/password` PATCH routes.
   *
   * The gateway's EXACT map is keyed on a literal path and these carry a
   * parameter segment. `/lock` also becomes `/status` and takes an enum where
   * the marketing variant took `{lock: true}` — the same operation with two
   * body shapes in legacy, which is why the two handlers had drifted.
   */

  // ── admin/staff — the hierarchy and the money in it ──────────────────
  //
  // `legacy/system/` is the best-built code in this platform: real token
  // authentication, a closure table for the tree, an audit recorder on every
  // write. Two of its routes were nonetheless unreachable —
  // `/api/staff/transactions` was shadowed by `/:id`, and
  // `/api/staff/transfers/summary` by `/transfers/:id?`.
  'GET /api/staff': '/api/v1/admin/staff',
  'POST /api/staff': '/api/v1/admin/staff',
  'GET /api/staff/tree': '/api/v1/admin/staff/tree',
  'GET /api/staff/players': '/api/v1/admin/staff/players',
  'GET /api/staff/transactions': '/api/v1/admin/staff/transactions',
  'GET /api/staff/transfers': '/api/v1/admin/staff/transfers',
  'GET /api/staff/transfers/summary': '/api/v1/admin/staff/transfers/summary',
  'PATCH /api/staff/password': '/api/v1/admin/staff/password',
  'POST /api/staff/patch-bulk-status': '/api/v1/admin/staff/bulk-status',
  /**
   * NOT rewritten: `POST /api/staff/reset-password-for-staff`.
   *
   * The replacement is `PATCH /api/v1/admin/staff/password` with a `targetId`
   * in the body — the same endpoint that changes your own, distinguished by
   * whether a target is named. A rewrite cannot change the VERB, so a client on
   * the old path must move to PATCH.
   */
  /**
   * `POST /api/staff/transfer` moves money and now needs `wallet:adjust`
   * rather than the same middleware as every other route on the router. The
   * path is unchanged, so this is a rewrite; the permission is not, so a caller
   * whose token lacks it gets a 403 where it used to get a 200.
   */
  'POST /api/staff/transfer': '/api/v1/admin/staff/transfer',
  // The parameterised staff paths — `/api/staff/:id` and the rest — are in
  // PATTERNS below.

  // ── sports/bets — the money routes ───────────────────────────────────
  //
  // THREE legacy implementations. Two of them insert into `sports_bets`, a
  // table that does not exist, so `POST /sportsbetting/place` and `POST /bets`
  // have never placed a bet. The one that works reads `user_id`, `odds`,
  // `team_one`, `team_two` and the runner count from the REQUEST BODY on an
  // unauthenticated route.
  //
  // `/api/v1/sports/bets` is a VERBATIM port of the one that works, so the
  // legacy payload and the legacy response body are unchanged — the only
  // difference a caller sees is that the route authenticates and `user_id` in
  // the body is ignored in favour of the token.
  'POST /sportsbetting/place': '/api/v1/sports/bets',
  'POST /api/sportsmain/place-bet': '/api/v1/sports/bets',
  'POST /bets': '/api/v1/sports/bets',

  'GET /api/sportsmain/user-open-bets': '/api/v1/sports/bets',
  'GET /api/sportsmain/user-sports-open-bets': '/api/v1/sports/bets',

  // ── sports/bet-admin ─────────────────────────────────────────────────
  //
  // Every report was scoped by an `x-staff-id` REQUEST HEADER — the caller
  // sets it, and `x-staff-id: 1` is the platform owner. The two lock toggles
  // had no scoping and no authentication at all.
  'GET /api/sportsmain/admin/bet-list': '/api/v1/admin/sports/bet-admin/bets',
  'GET /api/sportsmain/admin/bet-ticker': '/api/v1/admin/sports/bet-admin/bets/ticker',
  'GET /api/sportsmain/admin/bet-list-by-user': '/api/v1/admin/sports/bet-admin/bets/by-user',
  'GET /api/sportsmain/admin/net-exposure': '/api/v1/admin/sports/bet-admin/exposure',
  'POST /api/sportsmain/admin/game-report': '/api/v1/admin/sports/bet-admin/reports/game',
  'GET /api/sportsmain/admin/betlock/users': '/api/v1/admin/sports/bet-admin/locks/users',
  'GET /api/sportsmain/admin/betlock/staff': '/api/v1/admin/sports/bet-admin/locks/staff',
  'POST /api/sportsmain/admin/betlock/user/toggle': '/api/v1/admin/sports/bet-admin/locks/users',
  'POST /api/sportsmain/admin/betlock/staff/toggle': '/api/v1/admin/sports/bet-admin/locks/staff',
  'GET /sportsbetting/admin/bets': '/api/v1/admin/sports/bet-admin/bets',
  'GET /admin/bets': '/api/v1/admin/sports/bet-admin/bets',

  // ── sports/results ───────────────────────────────────────────────────
  //
  // `GET /sportsbetting` — the bare root of the betting router — was a listing
  // of every settled market with no scoping whatsoever.
  'GET /sportsbetting': '/api/v1/admin/sports/results/markets',
  'GET /sportsbetting/marketwins': '/api/v1/admin/sports/results/markets',
  'GET /sportsbetting/fanwins': '/api/v1/admin/sports/results/fancy',

  // ── sports/feed — the second provider ────────────────────────────────
  //
  // `sportsmain` reads from `http://159.198.77.241:8100` (a second bare IP
  // over cleartext) and from a host with `-demo-` in its name for the live
  // video stream and scorecard, with the key in the query string.
  //
  // All five were POSTs carrying their parameters in the body, and all five
  // are reads. A client must change verb — a rewrite cannot move a JSON body
  // into a query string, so these are deliberately absent from the map:
  //
  //   POST /api/sportsmain/get-all-sports-data → GET /feed/live/data
  //   POST /api/sportsmain/get-sports-data-id  → GET /feed/live/match
  //   POST /api/sportsmain/get-result          → GET /feed/live/result
  //   POST /api/sportsmain/get-live-stream     → GET /feed/live/stream
  //   POST /api/sportsmain/get-scorecard       → GET /feed/live/scorecard

  // ── The three routes that were never sports concerns ─────────────────
  //
  // A wallet read, a transfer history and a PASSWORD CHANGE, all mounted
  // inside the sports betting router and all keyed on a `uuid` in the URL with
  // no authentication.
  //
  // `PUT /sportsbetting/password/:userUuid` also stored the new password in
  // cleartext in `users.password2` and posted it to a third-party host. It is
  // deliberately NOT rewritten: the replacement takes the player from a token
  // and the old body shape does not fit it, so a 404 at the old path is the
  // honest answer rather than a redirect to an endpoint that will reject it.
  'GET /sportsbetting/wallet/:uuid': '/api/v1/user/wallet/balances',
  'GET /sportsbetting/transfers/:userUuid': '/api/v1/user/history/transfers',

  // ── sports/catalogue — what is switched on ───────────────────────────
  //
  // Twelve administrative writes with NO authentication, guarded only by a
  // middleware that checks whether sports are globally enabled. And
  // `admin_fancy_control` — the table five of them read and write — was never
  // created, so all five have returned 500 since they were written.
  'GET /sports/sports-config': '/api/v1/admin/sports/catalogue/sports',
  'POST /sports/sports-config': '/api/v1/admin/sports/catalogue/sports',
  'GET /sports/sports': '/api/v1/sports/catalogue/sports',
  'GET /sports/admin/fancy-controls': '/api/v1/admin/sports/catalogue/fancy',
  'POST /sports/admin/update-fancy-status': '/api/v1/admin/sports/catalogue/fancy',
  'POST /sports/admin/bulk-update-fancy-status': '/api/v1/admin/sports/catalogue/fancy/bulk',

  // ── platform ─────────────────────────────────────────────────────────
  // `siteconfig.sports` is admin-owned, so the flag lives with the rest of the
  // site configuration and sports-service reads it over the internal API.
  'GET /sportsCheck': '/api/v1/admin/site-config/sports',

  // ── user/gift-cards (all unauthenticated; player named by :userId or body) ──
  'POST /giftCard/admin/create': '/api/v1/admin/user/gift-cards',
  'GET /giftCard/admin/list': '/api/v1/admin/user/gift-cards',
  'GET /giftCard/admin/analytics': '/api/v1/admin/user/gift-cards/analytics',
  'GET /giftCard/admin/records': '/api/v1/admin/user/gift-cards/records',
  'POST /giftCard/search': '/api/v1/admin/user/gift-cards/search',
  'POST /giftCard/activate': '/api/v1/user/gift-cards/activate',
  'POST /giftCard/claim': '/api/v1/user/gift-cards/claim',

  // ── user/spin-wheel ─────────────────────────────────────────────────
  'GET /api/spinwin/slices': '/api/v1/user/spin-wheel/slices',
  'GET /api/spinwin/user/eligibility': '/api/v1/user/spin-wheel/eligibility',
  'POST /api/spinwin/user/claim': '/api/v1/user/spin-wheel/spin',
  'GET /api/spinwin/admin/config': '/api/v1/admin/user/spin-wheel/config',
  'PUT /api/spinwin/admin/config': '/api/v1/admin/user/spin-wheel/config',
  'GET /api/spinwin/admin/slices': '/api/v1/admin/user/spin-wheel/slices',
  'POST /api/spinwin/admin/slices': '/api/v1/admin/user/spin-wheel/slices',
  'PUT /api/spinwin/admin/slices-bulk': '/api/v1/admin/user/spin-wheel/slices-bulk',
  'GET /api/spinwin/admin/claims': '/api/v1/admin/user/spin-wheel/claims',

  // ── user/bonus ──────────────────────────────────────────────────────
  //
  // Legacy authenticated these with a shared static `role-key` HEADER and
  // named the player with a `userid` query parameter. A client calling the old
  // path must send a bearer token and drop the parameter — the rewrite finds
  // the right handler, it does not make the old request shape work.
  'GET /Userbonus/api/bonuses': '/api/v1/user/bonus',
  'GET /Userbonus/api/bonus-history': '/api/v1/user/bonus/history',
  'POST /bonus/redeem-bonus/redeem': '/api/v1/user/bonus/redeem',
  /**
   * NOT REWRITTEN, deliberately:
   *
   *   POST /bonus/user          → GET /api/v1/user/bonus/codes
   *   POST /bonus/userbonus     → GET /api/v1/user/bonus/record
   *   POST /bonus/bonusgame     → GET /api/v1/user/bonus/games
   *   POST /bonus/bonushistory  → GET /api/v1/user/bonus/events
   *
   * All four are READS that legacy served over POST, with the player named by a
   * `userid` field in the body. The rewriter changes the path and nothing else,
   * so a POST would arrive at a GET-only route and 404 — and the body it
   * carries has no meaning here anyway, because the player comes from the token.
   *
   * A client on these paths has to change the verb and send a bearer token.
   * Leaving a rewrite in place would only turn a clear 404 at the old path into
   * a confusing one at the new path.
   */
  'GET /bonus/admin/userbonus': '/api/v1/admin/user/bonus/records',
  'GET /bonus/admin/bonusgame': '/api/v1/admin/user/bonus/games',
  'GET /bonus/admin/bonushistory': '/api/v1/admin/user/bonus/events',
  'GET /bonus/redeem-bonus': '/api/v1/admin/user/bonus/codes',
  'POST /bonus/redeem-bonus/create': '/api/v1/admin/user/bonus/codes',
  'GET /bonus/users': '/api/v1/admin/user/bonus/users',
  'POST /bonus/createuserbonus': '/api/v1/admin/user/bonus/records',
  'PUT /bonus/userbonus': '/api/v1/admin/user/bonus/records',
  'DELETE /bonus/userbonus': '/api/v1/admin/user/bonus/records',
  'POST /bonus/createbonusgame': '/api/v1/admin/user/bonus/games',
  'PUT /bonus/bonusgame': '/api/v1/admin/user/bonus/games',
  'DELETE /bonus/bonusgame': '/api/v1/admin/user/bonus/games',
  'POST /bonus/createbonushistory': '/api/v1/admin/user/bonus/events',
  'GET /Adminbonus/api/admin/bonuses': '/api/v1/admin/user/bonus/dashboard',
  /**
   * NOT rewritten: `PUT /bonus/bonushistory` and `DELETE /bonus/bonushistory`.
   *
   * Both took only a `userid` and acted on every log row that player had —
   * `bonushistory` has no primary key, so there was no expression that named a
   * single row. The replacements are `PUT|DELETE /bonus/events/:id`, which need
   * an id the old caller never had and could not have obtained.
   *
   * A rewrite would have to invent one. These are 404 at the old path, which is
   * the honest answer: the operation the client was performing does not exist
   * any more, because it was "rewrite this player's entire bonus history to one
   * value".
   */

  // ── user/affiliate ──────────────────────────────────────────────────
  //
  // `process-wager` moves to a STAFF route: it creates a payable, and legacy
  // let the caller choose the reward tier by posting a wager figure.
  // The team and rewards reads move to the caller's own code — the legacy
  // paths keyed on a `:referralCode` that is public by design.
  'POST /affiliate/claim-reward': '/api/v1/user/affiliate/rewards/claim',
  'POST /affiliate/claim-reward-all': '/api/v1/user/affiliate/rewards/claim-all',
  'POST /affiliate/team/add': '/api/v1/user/affiliate/team/join',
  'POST /affiliate/process-wager': '/api/v1/admin/user/affiliate/unlock',
  'POST /affiliate/rewards/record': '/api/v1/admin/user/affiliate/rewards',
  'GET /affiliateAdmin/teams': '/api/v1/admin/user/affiliate/teams',
  'GET /affiliateAdmin/users-with-teams': '/api/v1/admin/user/affiliate/members',
  'GET /affiliateAdmin/dashboard-stats': '/api/v1/admin/user/affiliate/stats',
  'GET /affiliateAdmin/rewards-list': '/api/v1/admin/user/affiliate/rewards',
  'GET /affiliateAdmin/top-affiliates': '/api/v1/admin/user/affiliate/top',
  /**
   * The settings pair moves to admin-service, not user-service.
   *
   * They read and write `siteconfig.affiliatebonus`, `.comissionpercent` and
   * `.registerbonus`. `siteconfig` is in the `admin` model domain, which
   * user-service does not load — so these could not live beside the rest of the
   * affiliate code without user-service reaching into a table it does not own.
   *
   * Legacy served both with no middleware at all, so the PUT was an
   * unauthenticated write to the platform's payout rates.
   */
  'GET /affiliateAdmin/settings': '/api/v1/admin/site-config/affiliate',
  'PUT /affiliateAdmin/settings': '/api/v1/admin/site-config/affiliate',

  // ── user/clubs ──────────────────────────────────────────────────────
  //
  // Every one of these was erroring in production: the controller queries
  // `club_memberships`, which did not exist until migration 014.
  'POST /clubmembership/create': '/api/v1/user/clubs',
  'POST /clubmembership/join': '/api/v1/user/clubs/join',
  'POST /clubmembership/change-role': '/api/v1/user/clubs/members/role',
  'PUT /clubmembership/earnings-config': '/api/v1/user/clubs/earnings-config',
  'GET /clubmembership/clubs/fetch': '/api/v1/admin/user/clubs',

  // ── user/email — one-time codes and operator mail ───────────────────
  //
  // `/otp/send` and `/otp/resend` were two handlers differing only by a
  // cooldown one of them skipped, which is how the attempt limit became
  // unreachable. They are one route.
  'POST /email/otp/send': '/api/v1/user/email/otp',
  'POST /email/otp/resend': '/api/v1/user/email/otp',
  'POST /email/otp/verify': '/api/v1/user/email/otp/verify',

  // `/send-otp` returned the code in its own response body. The rewrite gets a
  // caller to the right handler; it does NOT make the old contract work,
  // because the code is no longer in the answer.
  'POST /send-otp': '/api/v1/user/email/otp',

  'POST /email/2fa/reset': '/api/v1/user/email/2fa/reset',
  'POST /email/2fa/reset-verify': '/api/v1/user/email/2fa/reset/confirm',

  // Both were unauthenticated with the recipient and the HTML in the body.
  // Staff-only now.
  'POST /email/email/send': '/api/v1/admin/user/email/send',
  'POST /email/bulk': '/api/v1/admin/user/email/bulk',

  // ── user/club-broadcasts — banners and notifications ────────────────
  //
  // All six tables behind these were missing, so every one returned 500. They
  // were also unauthenticated with the actor named in the request body, and the
  // image route was a path traversal.
  'POST /clubbanner/clubs/:clubId/banners': '/api/v1/user/club-broadcasts/clubs/:clubId/banners',
  'GET /clubbanner/clubs/:clubId/banners': '/api/v1/user/club-broadcasts/clubs/:clubId/banners',
  'PUT /clubbanner/clubs/:clubId/banners/:bannerId':
    '/api/v1/user/club-broadcasts/clubs/:clubId/banners/:bannerId',
  'DELETE /clubbanner/clubs/:clubId/banners/:bannerId':
    '/api/v1/user/club-broadcasts/clubs/:clubId/banners/:bannerId',
  'POST /clubbanner/clubs/:clubId/banners/:bannerId/notify':
    '/api/v1/user/club-broadcasts/clubs/:clubId/banners/:bannerId/notify',
  'GET /clubbanner/clubs/:clubId/banner-notifications':
    '/api/v1/user/club-broadcasts/clubs/:clubId/banner-notifications',
  'PUT /clubbanner/clubs/banner-notifications/:notificationId/read':
    '/api/v1/user/club-broadcasts/banner-notifications/:notificationId/read',

  'POST /clubnotification/clubs/:clubId/notifications':
    '/api/v1/user/club-broadcasts/clubs/:clubId/notifications',
  'GET /clubnotification/clubs/:clubId/notifications':
    '/api/v1/user/club-broadcasts/clubs/:clubId/notifications',
  'PUT /clubnotification/clubs/notifications/:notificationId/read':
    '/api/v1/user/club-broadcasts/notifications/:notificationId/read',

  /**
   * NOT REWRITTEN: `GET /clubbanner/clubs/banner-image/:imagePath(*)`.
   *
   * The legacy path took a WILDCARD segment and joined it onto a storage root
   * with no containment check, so it read any file the process could open. The
   * replacement is `GET /api/v1/user/club-broadcasts/banner-image/*`, which
   * requires a player token and checks club membership before touching disk.
   *
   * Deliberately not aliased: a client still calling the old path should get a
   * clear 404 rather than be routed to something that looks like the same
   * endpoint but refuses most of what it used to serve.
   */

  // ── user/directory ──────────────────────────────────────────────────
  //
  // `GET /users` was `SELECT * FROM users`, unauthenticated — every player's
  // bcrypt hash and contact details. Staff-only, with an explicit column list.
  'GET /users': '/api/v1/admin/user/directory',
  'GET /getUserData': '/api/v1/admin/user/directory',
  'GET /user-summary': '/api/v1/admin/user/directory/summary',

  /**
   * NOT REWRITTEN: `DELETE /deleteUser`.
   *
   * It enumerated `information_schema` and deleted from every table with a
   * column named user_id/userid/uid/id_user/user — the ledger, the bets, the
   * deposits, the KYC record — unauthenticated, with the id in the body.
   *
   * `DELETE /api/v1/admin/user/directory/:userId` exists and answers 501 with
   * what to do instead. It is deliberately NOT wired to the old path: a client
   * still calling `/deleteUser` should get a clear 404 rather than be quietly
   * routed to something that looks like the same operation.
   */

  // One currency. Legacy read `uid` from the query and built the column name by
  // interpolating `coin_symbol` into the SELECT.
  'GET /user/api/balance': '/api/v1/user/wallet/balances',

  // ── casino/seamless — the provider's bet/win callbacks ──────────────
  //
  // These paths are configured on the PROVIDER's side and cannot be renamed
  // without a support request. The request and response shapes are unchanged;
  // what changed is that a replay now expires, a retry is recognised, and the
  // balance moves by a guarded delta instead of an absolute write.
  'POST /api/seamless/balance': '/api/v1/casino/seamless/balance',
  'POST /api/seamless/withdraw': '/api/v1/casino/seamless/withdraw',
  'POST /api/seamless/deposit': '/api/v1/casino/seamless/deposit',
  'POST /api/seamless/transfer': '/api/v1/casino/seamless/transfer',
  'POST /api/seamless/rollback': '/api/v1/casino/seamless/rollback',
  'POST /api/seamless/cancel': '/api/v1/casino/seamless/cancel',
  'POST /api/seamless/pushbet': '/api/v1/casino/seamless/pushbet',

  // ── casino/gis — Slotegrator ────────────────────────────────────────
  //
  // The callback path is configured on SLOTEGRATOR's side. The rest are ours,
  // and are mapped so existing clients keep working through the cutover.
  'POST /api/gis/callback/transactions': '/api/v1/casino/gis/callback/transactions',

  // Launch used to take `player_id` from the body on an unauthenticated route.
  // It now needs a player token — a client calling this must send one.
  'POST /api/gis/games/init': '/api/v1/casino/gis/launch',
  'POST /api/gis/games/init-demo': '/api/v1/casino/gis/launch-demo',
  'GET /api/gis/games/lobby': '/api/v1/casino/gis/lobby',
  'GET /api/gis/game-tags': '/api/v1/casino/gis/game-tags',
  'GET /api/gis/limits': '/api/v1/casino/gis/limits',
  'GET /api/gis/limits/freespin': '/api/v1/casino/gis/limits/freespin',
  'GET /api/gis/jackpots': '/api/v1/casino/gis/jackpots',
  'GET /api/gis/freespins/bets': '/api/v1/casino/gis/freespins/bets',

  // Campaigns and vouchers were unauthenticated AND had no table behind them.
  // They are staff-only now, and they work.
  'POST /api/gis/freespins/set': '/api/v1/admin/casino/gis/freespins',
  'GET /api/gis/freespins/get': '/api/v1/admin/casino/gis/freespins',
  'POST /api/gis/freespins/cancel': '/api/v1/admin/casino/gis/freespins/cancel',
  'POST /api/gis/freevouchers/set': '/api/v1/admin/casino/gis/vouchers',
  'GET /api/gis/freevouchers/get': '/api/v1/admin/casino/gis/vouchers',
  'POST /api/gis/freevouchers/cancel': '/api/v1/admin/casino/gis/vouchers/cancel',
  'GET /api/gis/self-validate': '/api/v1/admin/casino/gis/self-validate',

  // The syncs were GETs that wrote hundreds of rows. They are POSTs now, so a
  // prefetch cannot run one — a client calling them has to change the verb.
  'POST /api/gis/sync/gamesnew': '/api/v1/admin/casino/gis/sync/games',
  'POST /api/gis/sync/providersnew': '/api/v1/admin/casino/gis/sync/providers',

  // ── casino/sportsbook — Slotegrator betting ─────────────────────────
  //
  // `legacy/sportsbook/routes.js` WAS NEVER MOUNTED, so these paths have never
  // served a request and nothing depends on them. They are mapped anyway: a
  // client written against the source rather than against the running server
  // would otherwise get a 404 with no explanation.
  'GET /sportsbooks': '/api/v1/casino/sportsbook',
  // `init` took `player_id` from the body. It needs a player token now.
  'POST /sportsbooks/init': '/api/v1/casino/sportsbook/init',
  'POST /sportsbooks/logout': '/api/v1/casino/sportsbook/logout',
  'POST /sportsbooks/refresh-token': '/api/v1/casino/sportsbook/refresh',
  //
  // `GET /sportsbooks/launch?url=…` IS DELIBERATELY NOT MAPPED. It fetched any
  // URL the caller named and returned the body — a server-side request proxy.
  // A rewrite would be a promise that the capability still exists somewhere,
  // and it does not. `init` returns the launch URL; the browser opens it.

  // ── casino/games — the local catalogue and its curation ─────────────
  'GET /api/gis/gamesgis': '/api/v1/casino/games',
  'GET /api/gis/gamesgis/stats': '/api/v1/casino/games/stats',
  'GET /api/gis/providersgis': '/api/v1/casino/games/providers',
  'GET /api/gis/hotgames': '/api/v1/casino/games/collections/hot',
  'GET /api/gis/livecasino': '/api/v1/casino/games/collections/live-casino',
  'GET /api/gis/popularslots': '/api/v1/casino/games/collections/popular-slots',
  'GET /api/gis/crashgames': '/api/v1/casino/games/collections/crash',
  'GET /api/gis/indiangames': '/api/v1/casino/games/collections/indian',
  'GET /api/gis/games/recently-played': '/api/v1/casino/games/recently-played',

  // Every one of these was unauthenticated in legacy, under a comment reading
  // "// Admin (protect this)". They require a staff token now.
  'PUT /api/gis/admin/gis/hotgames': '/api/v1/admin/casino/games/collections/hot',
  'PUT /api/gis/admin/gis/livecasino': '/api/v1/admin/casino/games/collections/live-casino',
  'PUT /api/gis/admin/gis/popularslots': '/api/v1/admin/casino/games/collections/popular-slots',
  'PUT /api/gis/admin/gis/crashgames': '/api/v1/admin/casino/games/collections/crash',
  'PUT /api/gis/admin/gis/indiangames': '/api/v1/admin/casino/games/collections/indian',
  'GET /api/gis/admin/gis/vendors': '/api/v1/admin/casino/games/vendors',
  'GET /api/gis/admin/gis/vendor-search': '/api/v1/admin/casino/games/vendor-search',
  'GET /api/gis/admin/gis/types': '/api/v1/admin/casino/games/types',
  'GET /api/gis/admin/gis/type-search': '/api/v1/admin/casino/games/type-search',
  'GET /api/gis/admin/gis/games/search': '/api/v1/admin/casino/games/catalogue/search',
  'GET /api/gis/admin/providers': '/api/v1/admin/casino/games/providers',
  'PUT /api/gis/admin/providers': '/api/v1/admin/casino/games/providers',

  // ── casino/js-games — huidu.bet (v1) and games.ibitplay.com (v2) ────
  //
  // Both callback paths are configured on the PROVIDERS' side.
  'POST /jsGames/game/bet-callback': '/api/v1/casino/js-games/v1/bet-callback',
  'POST /jsGamesv2/bet-callback': '/api/v1/casino/js-games/v2/bet-callback',

  'GET /jsGames/games': '/api/v1/casino/js-games/v1/games',
  'GET /jsGames/games/search': '/api/v1/casino/js-games/v1/games/search',
  'GET /jsGamesv2/games': '/api/v1/casino/js-games/v2/games',
  'GET /jsGamesv2/games/search': '/api/v1/casino/js-games/v2/games/search',

  // Launches took `user_id` from the body; history took it from the query.
  'POST /jsGames/game/launch': '/api/v1/casino/js-games/v1/launch',
  'POST /jsGamesv2/launch': '/api/v1/casino/js-games/v2/launch',
  'GET /jsGamesv2/history': '/api/v1/casino/js-games/v2/history',

  // Transfer credited the provider's wallet for any named player, with no
  // authentication and no matching debit. Staff only.
  'POST /jsGames/game/transfer': '/api/v1/admin/casino/js-games/v1/transfer',
  'POST /jsGames/game/transactions': '/api/v1/admin/casino/js-games/v1/transactions',
  'GET /jsGamesv2/historyAdmin': '/api/v1/admin/casino/js-games/v2/history',

  // ── casino/seamless — the operator side of the same integration ─────
  //
  // `POST /launch-game` read `users.password` and sent the bcrypt hash to the
  // provider, unauthenticated, with the player named in the body. It needs a
  // player token now and there is no member parameter.
  'GET /fetch-products': '/api/v1/casino/seamless/products',
  'GET /fetch-games': '/api/v1/casino/seamless/games',
  'POST /launch-game': '/api/v1/casino/seamless/launch',

  // ── casino/aggregators — the three remaining wallet callbacks ───────
  //
  // None of these had ANY authentication. They now require the shared secret in
  // `x-aggregator-key`, which has to be agreed with each provider before their
  // callbacks will settle — until then they refuse rather than falling open.
  'POST /processRequest': '/api/v1/casino/aggregators/asia',
  'POST /gold_api': '/api/v1/casino/aggregators/nexus',
  'POST /callback_evo': '/api/v1/casino/aggregators/evo',

  // ── casino/bet-history ──────────────────────────────────────────────
  //
  // Every staff route here was scoped by a raw `x-staff-id` HEADER with no
  // authentication. They require a staff token now; the header is ignored.
  'GET /betHistory/transactions': '/api/v1/admin/casino/bet-history/transactions',
  'GET /betHistory/transactions/stats': '/api/v1/admin/casino/bet-history/stats',
  'GET /betHistory/admin/analytics': '/api/v1/admin/casino/bet-history/analytics',

  // The public ticker. Legacy answered `SELECT *`, exposing every player id.
  'GET /live-bets': '/api/v1/casino/bet-history/live',

  // `/bet30` and `/bet1` read `?id=` from the query with no authentication.
  // The player comes from the token, and the interval is a query parameter.
  'GET /bet30': '/api/v1/casino/bet-history/timed-rounds',
  'GET /bet1': '/api/v1/casino/bet-history/timed-rounds',

  // ── casino/x-gaming — the apigames vendor catalogue ─────────────────
  'GET /xGaming/by-vendor': '/api/v1/casino/x-gaming/by-vendor',
  'GET /xGaming/vendors': '/api/v1/casino/x-gaming/vendors',
  'GET /xGaming/games/search': '/api/v1/casino/x-gaming/games/search',

  // ── sports/settlement (was legacy/mannualsettlement, mounted at /api/internalsettle) ──
  'GET /api/internalsettle/momatches': '/api/v1/admin/sports/settlement/mo-matches',
  'GET /api/internalsettle/fanmatches': '/api/v1/admin/sports/settlement/fancy-matches',
  'GET /api/internalsettle/open-bets': '/api/v1/admin/sports/settlement/open-bets',
  'POST /api/internalsettle/declareresult': '/api/v1/admin/sports/settlement/declare-result',
  'POST /api/internalsettle/void': '/api/v1/admin/sports/settlement/void-market',
  'POST /api/internalsettle/void-single-bet': '/api/v1/admin/sports/settlement/void-bet',
  'GET /api/internalsettle/settled-markets': '/api/v1/admin/sports/settlement/settled-markets',
  'GET /api/internalsettle/settled-bets': '/api/v1/admin/sports/settlement/settled-bets',
  'POST /api/internalsettle/void-market-after-settlement':
    '/api/v1/admin/sports/settlement/void-market/post-settlement',
  'POST /api/internalsettle/void-bet-after-settlement':
    '/api/v1/admin/sports/settlement/void-bet/post-settlement',
};

/**
 * Parameterised rewrites, for legacy paths that carry an id segment.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * The EXACT map is keyed on a literal path, so it cannot express
 * `GET /api/staff/:id`. Roughly two dozen ported routes carry a parameter
 * segment, and until this table they simply were not rewritten — the comments
 * through this file note each one as "cannot be expressed in the EXACT map"
 * and spell out the mapping in prose. Prose does not route requests:
 * `GET /api/staff/1` answered `404 Route GET /api/staff/1 does not exist`
 * while `GET /api/v1/admin/staff/1` worked.
 *
 * ── HOW A PATTERN IS WRITTEN ───────────────────────────────────────────────
 *
 *   `:name` matches ONE path segment of DIGITS (`\d+`), because every
 *   parameter here is a database id. Write `:name(<regex>)` to widen it — e.g.
 *   `:slug([^/]+)` for a referral code.
 *
 *   The default is deliberately narrow. A `[^/]+` parameter in
 *   `/api/staff/:id` would also swallow `/api/staff/tree`, and a legacy
 *   literal path added to EXACT later would be shadowed by a pattern written
 *   today. Digits cannot collide with a route name.
 *
 *   The target may carry its own query string; it is MERGED with the caller's,
 *   and the caller's value wins on a collision.
 *
 * First match wins, in declaration order, and EXACT is checked before any of
 * these — so a literal path is never captured by a pattern.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const PATTERNS = [
  // ── admin/staff ─────────────────────────────────────────────────────
  //
  // `rollupStaff` and `metrics` were three legacy handlers over the same two
  // counts and one balance sum; they are one route with `?includeSubtree=`.
  ['GET /api/staff/rollup/:id', '/api/v1/admin/staff/rollup/:id'],
  ['GET /api/staff/rollupStaff/:id', '/api/v1/admin/staff/rollup/:id?includeSubtree=true'],
  ['GET /api/staff/metrics/:id', '/api/v1/admin/staff/rollup/:id'],
  ['GET /api/staff/analytics/:id', '/api/v1/admin/staff/analytics/:id'],

  // `/transfers/summary/:id` scopes by a path segment in legacy and by a query
  // parameter now — the summary route is literal so that `/transfers/:id` can
  // stay reachable beneath it.
  ['GET /api/staff/transfers/summary/:id', '/api/v1/admin/staff/transfers/summary?staffId=:id'],
  ['GET /api/staff/transfers/:id', '/api/v1/admin/staff/transfers/:id'],

  ['GET /api/staff/:id/percent-chain', '/api/v1/admin/staff/:id/percent-chain'],
  ['GET /api/staff/:id/percent-tree', '/api/v1/admin/staff/:id/percent-tree'],
  ['GET /api/staff/:id/whatsapp-ref', '/api/v1/admin/staff/:id/whatsapp-ref'],

  ['GET /api/staff/:id', '/api/v1/admin/staff/:id'],
  ['PATCH /api/staff/:id', '/api/v1/admin/staff/:id'],
  /**
   * `DELETE /api/staff/:id` refuses an account that still has descendants, a
   * balance or players, where legacy deleted the row and orphaned the subtree.
   * The path is unchanged, so this is a rewrite; the outcome is not, so a
   * caller deleting a populated account now gets a 409 where it used to get a
   * 200 and an invisible branch.
   */
  ['DELETE /api/staff/:id', '/api/v1/admin/staff/:id'],

  // ── admin/risk ──────────────────────────────────────────────────────
  //
  // From `siteconfig/routes/adminRiskRoutes.js`, which the port missed in full.
  // The reviewer's view of one player now lives with the other player reports.
  ['GET /api/admin/user-risk/:userId', '/api/v1/admin/reports/user-risk/:userId'],
];

/**
 * Prefix rewrites, for whole mount points ported as a unit. Longest prefix
 * wins, so a more specific mapping can shadow a broader one.
 */
const PREFIXES = [
  // e.g. ['/api/internalsettle', '/api/v1/admin/sports/settlement'],
];

/** `'<METHOD> /a/:id/b'` -> `{ method, regex, params: ['id'] }`. */
function compilePattern(key) {
  const [method, path] = key.split(' ');
  const params = [];

  const source = path
    .split('/')
    .map((segment) => {
      const match = /^:([A-Za-z][A-Za-z0-9_]*)(?:\((.+)\))?$/.exec(segment);
      if (!match) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      params.push(match[1]);
      return `(${match[2] ?? '\\d+'})`;
    })
    .join('/');

  return { method, regex: new RegExp(`^${source}$`), params };
}

/**
 * Combine the target's own query string with the caller's.
 *
 * The caller wins on a collision: `?includeSubtree=true` baked into a target is
 * the default the legacy path implied, not an override of what was asked for.
 */
function mergeQuery(target, search) {
  if (!search) return target;

  const [path, targetSearch = ''] = target.split('?');
  if (!targetSearch) return `${path}?${search}`;

  const merged = new URLSearchParams(targetSearch);
  for (const [key, value] of new URLSearchParams(search)) merged.set(key, value);
  return `${path}?${merged.toString()}`;
}

function buildLegacyRewriter({ logger } = {}) {
  const prefixes = [...PREFIXES].sort((a, b) => b[0].length - a[0].length);
  const patterns = PATTERNS.map(([key, to]) => ({ ...compilePattern(key), to }));

  /**
   * Apply one rewrite.
   *
   * ═════════════════════════════════════════════════════════════════════
   * `req.originalUrl` HAS TO MOVE TOO, OR NONE OF THIS TABLE DOES ANYTHING
   *
   * Express mounts each proxy under a prefix (`routes.use('/api/v1/admin',
   * proxy)`), which STRIPS that prefix from `req.url` before the handler runs.
   * `createProxy` therefore rebuilds the upstream path from `req.originalUrl`,
   * which is the only place the whole path survives — and `originalUrl` is
   * captured by Express when the request arrives and is never touched again.
   *
   * Rewriting `req.url` alone moved the ROUTING DECISION and nothing else:
   * `POST /api/staff/auth/login` matched the `/api/v1/admin` prefix and was
   * correctly sent to admin-service, which was then asked for
   * `POST /api/staff/auth/login` — a path it does not have. Every one of the
   * ~600 mappings in this file answered 404 that way, from the upstream rather
   * than the gateway, which is why the 404 named a legacy path that the
   * gateway's own logs said it had just rewritten.
   *
   * The pre-rewrite path stays on `req.legacyPath` for logging, so nothing is
   * lost by moving `originalUrl` forward.
   * ═════════════════════════════════════════════════════════════════════
   */
  const apply = (req, pathname, search, target) => {
    // `mergeQuery`, not `${target}?${search}` — several targets carry their own
    // query (`/dashboard/today?kind=deposits`), and concatenating produced a
    // second `?`: `GET /today-deposits?date=X` became
    // `/dashboard/today?kind=deposits?date=X`, where `kind` parses as
    // `deposits?date=X` and matches no enum value.
    const rewritten = mergeQuery(target, search);
    req.legacyPath = pathname;
    req.url = rewritten;
    req.originalUrl = rewritten;
    logger?.info(
      { legacy_path: pathname, rewritten_to: target, method: req.method },
      'Legacy path rewritten'
    );
  };

  return function legacyRewrite(req, _res, next) {
    const [pathname, search = ''] = req.url.split('?');
    const key = `${req.method} ${pathname}`;

    const exact = EXACT[key];
    if (exact) {
      apply(req, pathname, search, exact);
      return next();
    }

    for (const pattern of patterns) {
      if (pattern.method !== req.method) continue;

      const match = pattern.regex.exec(pathname);
      if (!match) continue;

      const target = pattern.params.reduce(
        (path, name, i) => path.split(`:${name}`).join(match[i + 1]),
        pattern.to
      );
      apply(req, pathname, search, target);
      return next();
    }

    for (const [from, to] of prefixes) {
      if (pathname === from || pathname.startsWith(`${from}/`)) {
        apply(req, pathname, search, to + pathname.slice(from.length));
        return next();
      }
    }

    return next();
  };
}

module.exports = { buildLegacyRewriter, EXACT, PATTERNS, PREFIXES };
