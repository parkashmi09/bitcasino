/**
 * Every platform path the web app calls, in one place.
 *
 * The shape is not stylistic. `backend/tools/verify-frontend-routes.js` parses
 * registries exactly like this one — service roots as top-level `const`s, then
 * template literals interpolating them — mounts the four services, and fails
 * CI if a path here is not a route the backend actually serves. So a renamed
 * backend route breaks the build instead of a page, and that only works while
 * the paths live here rather than inline at the call site.
 *
 * Auth, the catalogue, the wallet reads and — as of Phase 5 — the two launch
 * routes and the player's own bet history are here. The account group lands
 * with Phase 6 (see `docs/10-backend-integration.md`).
 */

const USER = '/api/v1/user';
const CASINO = '/api/v1/casino';
const ADMIN = '/api/v1/admin';

export const ENDPOINTS = {
  // ── Auth ────────────────────────────────────────────────────────────
  // `register` answers 201 with the new account — `{id, name, email}` — and
  // deliberately opens no session. AuthProvider signs in with the same
  // credentials right after, so the form still lands on a signed-in home.
  register: `${USER}/auth/register`,
  login: `${USER}/auth/login`,
  refresh: `${USER}/auth/refresh`,
  logout: `${USER}/auth/logout`,
  me: `${USER}/auth/me`,
  sessions: `${USER}/auth/sessions`,
  // Idle logout (lib/idleTracker.js): the interaction heartbeat, and the check after N idle minutes.
  authActivity: `${USER}/auth/activity`,
  idleCheck: `${USER}/auth/idle-check`,
  changePassword: `${USER}/auth/change-password`,
  // Sign in with Google (`lib/googleAuth.js`). `googleStatus` is `{ enabled }` — the owner's
  // `google_login` switch; `googleStart` is a browser navigation, not a fetch.
  googleStatus: `${USER}/auth/google/status`,
  googleStart: `${USER}/auth/google/start`,
  googleExchange: `${USER}/auth/google/exchange`,

  // Public: resolves somebody else's referral code before signup submits it.
  verifyReferral: `${USER}/profile/verify-referral/:referralCode`,

  // ── Password recovery ───────────────────────────────────────────────
  // Three public routes, in order. All three are rate-limited, and the
  // limits differ because the risks do — see each one.
  //
  // ═══════════════════════════════════════════════════════════════════
  // THE THIRD ROUTE IS NEW. THE FIRST TWO WERE UNREACHABLE WITHOUT IT.
  //
  // `/email/otp` and `/email/otp/verify` have existed since the port and
  // neither had anything to hand its result to: nothing on the platform
  // spent a `reset-password` proof, and `AuthService.completePasswordReset`
  // — which does set a password — was exposed on no route and no socket
  // event. So the platform could issue a recovery code, confirm it was
  // correct, and then had no way to change the password.
  //
  // `POST /auth/reset-password` is that third leg. See
  // `backend/services/user/src/modules/auth/routes/public.routes.js`.
  // ═══════════════════════════════════════════════════════════════════

  // Issue a code. `{email, purpose}`, where `purpose` is a z.enum and
  // `reset-password` is the one this app sends.
  //
  // ANSWERS IDENTICALLY WHETHER OR NOT THE ADDRESS HAS AN ACCOUNT, and
  // sends nothing in the second case. That is deliberate — distinguishing
  // them turns this into an account-enumeration oracle — so the screen
  // after it cannot say "check your inbox, we found you". It says what was
  // done, not what was found.
  //
  // The code is NEVER in the response. Legacy's `POST /send-otp` answered
  // `{message, otp}`; a one-time code the requester is handed is not a
  // second factor.
  //
  // Limited to 5 a minute per IP, and separately to one per 120 seconds per
  // address — `EMAIL_OTP_COOLDOWN` carries `details.retryAfterSeconds`,
  // which is what the resend countdown is built from.
  emailOtp: `${USER}/email/otp`,

  // Check a code. `{email, purpose, code}` — exactly six digits, and a
  // prefix of a code is a 422 rather than a near miss.
  //
  // Three attempts per code, then `EMAIL_OTP_TOO_MANY_ATTEMPTS` and the
  // player must request another. On success the row is marked verified and
  // is PROOF for 300 seconds — which is the window the next call has.
  emailOtpVerify: `${USER}/email/otp/verify`,

  // Set the new password. `{email, code, newPassword}`.
  //
  // The code is sent AGAIN, and that is not redundancy. The proof left by
  // the verify step is keyed on the address alone; this route is
  // unauthenticated, so without re-checking the code, any caller naming
  // that address could set the password during the five minutes after a
  // victim verified their own. Re-checking makes the proof a record that
  // the code was used recently rather than a bearer credential.
  //
  // Answers `{reset, revokedSessions}` and **mints no session** — the
  // service has just revoked every session on the account, and handing back
  // a fresh one would re-open the door it closed. The player signs in.
  resetPassword: `${USER}/auth/reset-password`,

  // ── Profile ─────────────────────────────────────────────────────────
  // One path, two verbs: GET answers the player's own record, PUT edits it.
  // PUT is `.strict()` on the backend and accepts `username`, `country` and
  // `avatar` ONLY — sending anything else is a 422, not a silent drop. That
  // is why `useProfile` splits the account form's fields rather than posting
  // the whole thing.
  profile: `${USER}/profile`,

  // The player's own KYC state: `NotSubmitted` until they apply, then
  // `Pending` / `Verified` / `Rejected`. What the account page's identity
  // card branches on.
  kycStatus: `${USER}/kyc/status`,

  // ═══════════════════════════════════════════════════════════════════
  // The one MULTIPART post in the app. Send a `FormData`, and let `api.js`
  // omit the content-type — see the note there for why setting it is what
  // makes the server report every text field as missing.
  //
  // The route takes up to THREE files, on the fields `idFront`, `idBack` and
  // `passport`, alongside the seven text fields the validator requires.
  // Accepted types are JPEG, PNG and **PDF** — checked by MAGIC BYTES in the
  // service, not by the declared mimetype, because a `.png` starting `MZ` is
  // an executable whatever header the browser sent. The ceiling is **5 MB**
  // per file, from `MAX_FILE_BYTES`.
  //
  // (`docs/10`'s Phase 6 table says one file, 4 MB, and WebP. All three are
  // wrong against `kyc.constants.js`; the figures above are the code's.)
  // ═══════════════════════════════════════════════════════════════════
  kycSubmit: `${USER}/kyc/submit`,

  // ── Two-factor authentication ───────────────────────────────────────
  // All four are `player`, and none of them takes a `uid` — legacy's did,
  // on unauthenticated routes, so `POST /2fa/disable {"uid": 123}` turned off
  // any player's second factor. The id comes from the token now.
  //
  // `status` answers `{isEnabled, hasInitiated}`. `hasInitiated` is the
  // half-finished state: a secret was minted but never confirmed, which is
  // what an abandoned setup leaves behind.
  twoFactorStatus: `${USER}/2fa/status`,

  // Mints a secret and answers `{qrCode, secret}` — `qrCode` is a data URL,
  // `secret` the base32 for manual entry. Calling it again before confirming
  // issues a NEW secret, which is why the setup dialog holds the one it was
  // given rather than re-requesting on every render.
  twoFactorEnable: `${USER}/2fa/enable`,

  // Confirms the setup with a code from the app. Rate-limited to 10 attempts
  // per 15 minutes — a 6-digit code has a million possibilities and a
  // 30-second life, so an unmetered endpoint is minutes of brute force.
  twoFactorSetupVerify: `${USER}/2fa/setup-verify`,

  // Takes `{code, password}` — BOTH. Turning the second factor off is the
  // one action that lowers the account's security, so it needs the factor
  // itself and the thing it protects.
  twoFactorDisable: `${USER}/2fa/disable`,

  // ── Referrals ───────────────────────────────────────────────────────
  // The account's own code and the link built from it. `GET /user/profile`
  // already carries both, so this is only worth calling on its own where the
  // rest of the record is not wanted — which is what the refer page does.
  profileReferral: `${USER}/profile/referral`,

  // The referral programme proper. `team` answers
  // `{referralCode, total, members[]}` — `total` is the refer page's
  // "Total Referrals" — and `rewards` answers
  // `{total, totalAmount, rows[]}`, where `totalAmount` is a decimal STRING
  // summed by Postgres rather than by JavaScript over one page, and is the
  // page's "Total earned".
  //
  // Scoped to the caller on the backend. The legacy routes took the referral
  // code from the URL and answered whoever's team it named, which leaked a
  // whole downline with email addresses attached to anyone holding a code that
  // is meant to be public.
  affiliateTeam: `${USER}/affiliate/team`,
  affiliateRewards: `${USER}/affiliate/rewards`,
  // `{total, claimedTotal, currency}` waiting to be paid; claim-all pays every unclaimed tier and
  // commission row into the wallet and answers `{total, currency, count}` (409 NOTHING_TO_CLAIM).
  affiliateUnclaimed: `${USER}/affiliate/rewards/unclaimed`,
  affiliateClaimAll: `${USER}/affiliate/rewards/claim-all`,

  // ── Notifications (owner feature `notifications`) ───────────────────
  // The player's own inbox: rows `{id, title, body, type, read, createdAt}`, newest first.
  notifications: `${USER}/notifications`,
  notificationRead: `${USER}/notifications/:id/read`,
  notificationsReadAll: `${USER}/notifications/read-all`,

  // ── Preferences ─────────────────────────────────────────────────────
  // `userconfig`: theme, language, and the two notification switches. GET
  // answers the platform's named DEFAULTS for a player who has saved nothing,
  // so it never comes back half-empty. PATCH takes any subset.
  preferences: `${USER}/preferences`,

  // Public — no token. `[{ currency, usdRate, lastUpdated }]`, which is what
  // the footer's `1 USDT = …` pair is computed from.
  exchangeRates: `${USER}/exchange-rate/rates`,

  // ── Wallet ──────────────────────────────────────────────────────────
  // `balances` answers a currency-keyed map of decimal STRINGS, not numbers:
  // balances are NUMERIC(30,8) and a JSON number cannot carry that. The header
  // chip formats them, it never does arithmetic on them.
  walletBalances: `${USER}/wallet/balances`,
  walletBalance: `${USER}/wallet/balances/:currency`,

  // The ledger is **offset-based** (`limit`/`offset`), unlike the catalogue's
  // page/limit. Validators are `.strict()`, so sending `page` here is a 422.
  walletLedger: `${USER}/wallet/ledger`,

  // Every deposit and withdrawal in one call, across all seven rails —
  // crypto, fiat, and the three PSPs. Answers
  // `{deposits: {count, rows}, withdrawals: {count, rows}}`, NOT a flat list
  // and NOT `meta.pagination`: the two sides are counted separately because
  // they are merged from different tables.
  //
  // A row is `{kind, method, type, amount, currency, status, date, …}` with
  // `status` NORMALISED — the seven tables spell the same state four
  // different ways, and `method` says which rail a row came from.
  //
  // **Offset-based**, and `offset` is capped at 10,000: the endpoint merges
  // seven tables in memory and must read `offset + limit` from each to know
  // which rows survive the sort.
  history: `${USER}/history`,

  // Typed movement lists. All offset-based like the ledger.
  historyDeposits: `${USER}/history/deposits`,
  historyWithdrawals: `${USER}/history/withdrawals`,

  // Player-to-player transfers — tips in and out. A separate list because a
  // transfer is neither a deposit nor a withdrawal and would have no rail to
  // sit under in the combined view.
  historyTransfers: `${USER}/history/transfers`,

  // Submitted crypto withdrawals and their aggregate. The list is the record
  // of what a player asked for; the socket event is how they ask.
  withdrawalsCrypto: `${USER}/withdrawals/crypto`,
  // `{policy, ok, missing: ['kyc'|'wager'|'cap'|'daily'], kyc, wager, cap, dailyLimit, …}`;
  // `?currency=` (strict, the only key) gives that coin's cap/daily block. No cache.
  withdrawalRequirements: `${USER}/withdrawals/requirements`,
  // A fiat (bank / UPI) payout request: `{amount, currency, accountHolderName, upiId | bankName+accountNumber+ifscCode}`.
  withdrawFiat: `${USER}/withdrawals/fiat`,
  // The player's own payout addresses: `{whitelistOnly, addresses: [{id, label, currency,
  // network, address, memo}]}`. POST `{label, currency, network?, address, memo?}` (strict);
  // DELETE `/:id` (removing the last one switches enforcement off); PUT `enforcement`
  // `{enabled}` (refused on an empty list: WHITELIST_EMPTY_WHITELIST).
  withdrawWhitelist: `${USER}/withdrawals/whitelist`,
  withdrawWhitelistItem: `${USER}/withdrawals/whitelist/:id`,
  withdrawWhitelistEnforcement: `${USER}/withdrawals/whitelist/enforcement`,

  // ── Manual deposit (owner `deposit_mode` manual/both + admin switch) ──
  // The house accounts for a coin: `[{id, bankName, accountNumber, ifscCode,
  // accountHolderName, upiId, network, walletAddress, hasQrImage, minAmount,
  // maxAmount}]`; `?amount=` keeps only the accounts that take that amount.
  // `:id/qr` is the QR image (authenticated, read as a Blob).
  bankDetails: `${USER}/bank-details/:coin`,
  bankDetailsQr: `${USER}/bank-details/:coin/:id/qr`,
  // MULTIPART POST `{amount, currency, transactionId, bankName?, accountNumber?, ifscCode?,
  // accountHolderName?, upiId?, network?, walletAddress?}` + `screenshot` file; staff approve.
  fiatDeposits: `${USER}/deposits/fiat`,

  // Public — the coins and chains the deposit picker offers. Public because a
  // signed-out visitor is allowed to see what a site accepts before signing
  // up, which is what the reference's footer does with them.
  cryptoCoins: `${USER}/crypto/coins`,
  cryptoChains: `${USER}/crypto/chains`,

  // ── Payment providers (PSP deposits) ────────────────────────────────
  // The outbound half of the provider integrations, from the `payment-orders`
  // module (`basePath: '/payments'`). `methods/:provider` answers
  // `{provider, methods: [{method, currency}]}` for a provider the owner has
  // switched on, or refuses with `PAYORDER_PROVIDER_DISABLED` when it is off —
  // which the cashier reads as "do not offer this rail", not an error.
  //
  // `deposits` is `POST {provider, currency, amount, method?}` (`.strict()`,
  // so send nothing else) and answers an order `{reference, redirectUrl, …}`:
  // the player pays on `redirectUrl` and the provider's signed callback credits
  // the wallet. F2Pay is the one wired here — UPI in INR, USDT on TRON.
  paymentMethods: `${USER}/payments/methods/:provider`,
  paymentDeposits: `${USER}/payments/deposits`,

  // ── Swap and Vault ──────────────────────────────────────────────────
  // Both answer 403 NOT_ENTITLED outside the owner's plan and
  // *_NOT_FOR_AGENT_USERS to an agent's player. `swapEstimate` is
  // `GET ?fromCurrency&toCurrency&amount` (`.strict()`), `swap` is the same
  // three as a POST body. The vault is fixed-term: `vaultTransferIn` takes
  // `{coin, amount, lockPeriod}` (a `value` off `vaultLockOptions`),
  // `vaultTransferOut` names a `{depositId, coin}`, and `vault` answers
  // `{totals, deposits}`.
  swapEstimate: `${USER}/swap/estimate`,
  swap: `${USER}/swap`,
  vault: `${USER}/vault`,
  vaultLockOptions: `${USER}/vault/lock-options`,
  vaultTransferIn: `${USER}/vault/transfer-in`,
  vaultTransferOut: `${USER}/vault/transfer-out`,

  // ── Player history ──────────────────────────────────────────────────
  // What the header's `Recents` panel lists. Rows are
  // `{game_uuid, played_at, game}` and `game` is null for a title that has
  // left the catalogue since it was played.
  recentlyPlayed: `${CASINO}/games/recently-played`,

  // The player's own settled rounds, across all four casino sources —
  // `bets` (in-house), `gis_transactions`, and the two jsGames tables — merged
  // and normalised by the backend into one row shape. **Page-based**
  // (`page`/`limit`), and `.strict()`: `offset` here is a 422.
  //
  // An in-house row is ONE round: `amount` is the stake, `profit` the signed
  // win, `transaction_type` is `ROUND`. A provider row is a movement, so a
  // bet and its win are two rows sharing a `round_id`.
  betHistory: `${CASINO}/bet-history`,

  // ── Catalogue ───────────────────────────────────────────────────────
  // All public. Every one of these is `.strict()` on its query, and the
  // pairs DIFFER between them — sending the wrong one is a 422, not a
  // default. `queries/games.js` is the only place that builds them.
  //
  // `games` takes page/limit plus provider, type, search, technology and the
  // three tri-state booleans (has_lobby, has_freespins, is_mobile). Note
  // `is_mobile` is a SORT preference on this route, not a filter.
  games: `${CASINO}/games`,

  // Page/limit ONLY — a curated list takes no filters at all. `:collection`
  // is a z.enum of exactly: hot, live-casino, popular-slots, crash, indian.
  // Anything else is a 422 before the handler runs.
  gameCollection: `${CASINO}/games/collections/:collection`,

  // `q` and `limit` only. Answers a LEAN row — no `parameters`, no `images`,
  // no `label` — which is why `toGame` treats all three as optional.
  gameSearch: `${CASINO}/games/search`,

  // `gameTypes` and `topProviders`, which is the only place a per-provider
  // game count exists. The nav badges and the providers grid read it.
  gameStats: `${CASINO}/games/stats`,

  // `:provider` is the provider NAME, not a slug — `gis_providers` stores one
  // text column and nothing else. `adapters/providers.js` explains how a URL
  // slug gets back to a name.
  gamesByProvider: `${CASINO}/games/provider/:provider`,

  // Answers `{rows, total}` where a row is `{name}`. No id, no logo, no
  // count: those are ours.
  providers: `${CASINO}/games/providers`,

  // The site admin's lobby categories (Casino -> Lobby curation), in its order.
  // A category answers the games the admin picked; none picked = its automatic list (ours to fetch).
  lobbyCategories: `${CASINO}/games/categories`,
  lobbyCategory: `${CASINO}/games/categories/:slug`,

  // The in-house originals (dice, crash, limbo…), outside the catalogue.
  inHouseGames: `${CASINO}/js-games/v1/games`,

  // ═══════════════════════════════════════════════════════════════════
  // TWO PUBLIC CASINO READS ARE DELIBERATELY ABSENT FROM THIS TABLE.
  //
  // `GET /casino/bet-history/live` is the live-wins feed over HTTP, and it
  // was registered here through Phase 7. Phase 8 moved the ticker to the
  // `LAST_BETS` socket event, which answers the same rounds WITH the player
  // name attached — the HTTP route exposes no identity, and a wins strip
  // without a name on it is a list of numbers. Nothing calls the route now,
  // so it is not registered: a path in this file that no call site sends is
  // a contract check that verifies nothing. `queries/live.js` has the whole
  // argument.
  //
  // `GET /casino/catalogue/jackpots` answers `CATALOGUE_NOT_CONFIGURED`
  // without `CASINO_HUB_KEY`, a provider credential this deployment does not
  // have — the same situation as `GIS_MERCHANT_ID`. Registering it would
  // mean shipping a jackpot figure that can only ever be an error.
  // ═══════════════════════════════════════════════════════════════════

  // ── Aggregator launch ───────────────────────────────────────────────
  // Both `player`, both answer **201** with `{url}` for an iframe.
  //
  // `launch` opens a real-money session: it writes a `gis_sessions` row, calls
  // Slotegrator's `/games/init`, and records the play in recently-played. The
  // player id comes from the TOKEN — legacy took it from the request body on
  // an unauthenticated route, so anyone could open a session against any
  // account and play its balance.
  //
  // `launch-demo` is fun mode. No session row, no wallet, no player id.
  //
  // ═══════════════════════════════════════════════════════════════════
  // BOTH ANSWER 503 `GIS_NOT_CONFIGURED` ON THIS DEPLOYMENT.
  //
  // `GIS_MERCHANT_ID`/`GIS_MERCHANT_KEY` are unset, and the service refuses
  // rather than signing a request with `undefined` — a signature computed
  // against a missing key is stable and guessable, which is worse than no
  // call at all. So these are registered as the seam and `Play.jsx` renders
  // the refusal as a state rather than an error. Filling the two variables in
  // is what turns them real, with no code change here.
  // ═══════════════════════════════════════════════════════════════════
  gisLaunch: `${CASINO}/gis/launch`,
  // Any lobby game: the backend opens it through the owner's aggregator (JSGames V2 or GIS) and
  // answers `{gameLaunchUrl, via}` (casino `games/gameLauncher.js`).
  gameLaunch: `${CASINO}/games/launch`,
  gisLaunchDemo: `${CASINO}/gis/launch-demo`,
  // The Slotegrator sportsbook (`lib/sportsbookLaunch.js`): list the books, open / reopen a
  // session, close it on sign-out. 503 SPORTSBOOK_NOT_CONFIGURED while the provider is unset.
  sportsbooks: `${CASINO}/sportsbook`,
  sportsbookInit: `${CASINO}/sportsbook/init`,
  sportsbookRefresh: `${CASINO}/sportsbook/refresh`,
  sportsbookLogout: `${CASINO}/sportsbook/logout`,

  // ── Site configuration ──────────────────────────────────────────────
  // Public and rate-limited. The feature flags, the currencies the site
  // offers, the `home_*` section toggles and the advertised amounts. An
  // absent config row answers every flag ON with `configured: false`, and
  // `adapters/siteConfig.js` defaults the same way so first paint does not
  // flicker.
  siteConfig: `${ADMIN}/site-config/public`,
  // The OWNER's plan: `[{feature, kind?, variant, options?}]`, listed = on. Policies
  // (business_model, deposit_mode, …) ride in the same list. Read by `hooks/useGates.jsx`.
  ownerFeatures: `${ADMIN}/features/public`,
  // The OWNER panel's branding: name, title/meta, logo and square mark (`lib/branding.js`).
  branding: `${ADMIN}/branding/public`,

  // ── Content ─────────────────────────────────────────────────────────
  // All public, and all on ADMIN-service — the `public` audience mounts at
  // the same path as the staff one and only the guard differs, which is why
  // an `/admin/` path here is not a mistake.
  //
  // ═══════════════════════════════════════════════════════════════════
  // A BANNER IS AN IMAGE ON A PLACEMENT (`type`), with an optional title,
  // subtitle and link. `?mode=direct` lists this site's placements (anything
  // not prefixed `agent-`); `queries/promotions.js` reads the `slider-<n>` slides.
  // ═══════════════════════════════════════════════════════════════════
  banners: `${ADMIN}/banners`,

  // **raw** — the bytes, with the content type DETECTED from them rather than
  // trusted from the upload. Images live in the row as `BYTEA`, not on disk,
  // so this is the only way to render one. Used as an `<img src>`, never
  // fetched through `api.js`.
  bannerImage: `${ADMIN}/banners/image/:filename`,

  // Page-based (`page`/`limit`), `meta.pagination`. A list row carries the
  // metadata only — `description` (the body) comes back from the detail
  // routes below, so the index does not ship every post's full text.
  blogs: `${ADMIN}/blogs`,

  // The detail read. `slug` is the URL and is unique; `:id` also works but a
  // slug survives a re-import and an id does not.
  blogBySlug: `${ADMIN}/blogs/slug/:slug`,

  // Also page-based. `:category` is free text on the row, not an enum, so an
  // unknown one is an empty list rather than a 422.
  blogsByCategory: `${ADMIN}/blogs/category/:category`,

  // **raw**, same shape as the banner image. `imageUrl` on a post is null
  // when no image was uploaded, which is every seeded post.
  blogImage: `${ADMIN}/blogs/:id/image`,

  // ── Promotions ──────────────────────────────────────────────────────
  // Public: the prizes a signed-out visitor may see before signing up.
  // Answers `{slices, disabled}` — `disabled: true` with an empty list is the
  // operator having switched the wheel off, which is a state and not an error.
  spinSlices: `${USER}/spin-wheel/slices`,

  // Player. `{eligible, firstSpin, nextEligibleAt}`. `firstSpin` matters:
  // every spin after the first needs a qualifying deposit, so the button's
  // copy is different for a player who has never spun.
  spinEligibility: `${USER}/spin-wheel/eligibility`,

  // Player, rate-limited. Answers `{slice, isBadLuck, redeemCode, rewardPct}`.
  //
  // **No money moves.** The percentage is applied to the player's NEXT
  // deposit and what they get here is a redeem code, not a payout — the
  // service says so at the return. A screen that announced "you won 20%" as
  // a credit would be describing a different feature.
  spin: `${USER}/spin-wheel/spin`,

  // The VIP standing and the three periodic bonuses, in one read:
  // `{vip: {level, card, wager, nextLevel, wagerToNextLevel, progressPct},
  //   currency, types: {daily, weekly, monthly}}`.
  //
  // Each type carries `minVipLevel`, `eligible` and `claimable` — three
  // different things. A player can be eligible by level and still not
  // claimable if the window has not come round.
  bonus: `${USER}/bonus`,

  // `:type` is `daily` | `weekly` | `monthly`.
  bonusClaim: `${USER}/bonus/claim/:type`,

  // ═══════════════════════════════════════════════════════════════════
  // `/bonus/events` IS THE PLAYER'S OWN BONUS LOG. IT IS NOT A LIST OF
  // OPERATOR-RUN PROMOTIONS, AND THE NAME SAYS OTHERWISE.
  //
  // `docs/10`'s Phase 7 bullet reads it as the operator's scheduled events,
  // and so did this comment. `bonus.service.js#myEvents` is:
  //
  //     Bonushistory.findAndCountAll({ where: {userid}, order: createdat DESC })
  //
  // — `bonushistory`, scoped to the caller, shaped as
  // `{id, userId, event, amount, createdAt, updatedAt}`. There is no title,
  // no description and no window anywhere in it, and there is no scheduled-
  // promotions table on this platform at all: `bonus_events` does not exist.
  //
  // It went unnoticed because the table is EMPTY, so the page that read it
  // for `name`, `description` and `startDate` rendered its empty state and
  // looked right. With one row in it, every heading would have read
  // "Promotion" above a blank date range.
  //
  // Page-based. Player-scoped — it is the caller's own history.
  // ═══════════════════════════════════════════════════════════════════
  bonusEvents: `${USER}/bonus/events`,

  // ── Wager races (owner feature `races`) ─────────────────────────────
  // All public; a token, when sent, adds the caller's own `me` row. `races`
  // lists both configs (`enabled` is the admin's switch), `raceBoard` is the
  // open window, `raceHistory` the settled ones with their podium.
  races: `${USER}/race`,
  raceBoard: `${USER}/race/:type/leaderboard`,
  raceHistory: `${USER}/race/history`,
  // The caller's prizes (`?claimed=false` = waiting), rows `{id, type, rank, amount, currency, claimed}`.
  raceRewards: `${USER}/race/rewards`,
  raceRewardClaim: `${USER}/race/rewards/:rewardId/claim`,

  // ── Operator promotions (owner feature `promotions`) ────────────────
  // Public, on ADMIN-service. The list carries no body; the slug read does
  // (`description`/`termsHtml` are HTML). Slugs are unique per segment.
  promotionList: `${ADMIN}/promotions`,
  promotionBySlug: `${ADMIN}/promotions/slug/:segment/:slug`,

  // ── Rewards, rakeback, VIP (queries/rewards.js) ─────────────────────
  // `vip` feature + promotions capability. `{level, name, card, wager,
  // nextLevel, nextName, wagerToNextLevel, progressPct, currency,
  // wagerInCurrency, wagerToNextLevelInCurrency}` — the level is USD-based.
  vip: `${USER}/vip`,
  // Public. The ladder: `{unranked, bonusGates, levels: [{level, name, minXp, maxXp, card}]}`.
  vipLevels: `${USER}/vip/levels`,
  // Public with an optional session: the first-deposit terms and `eligible`.
  firstDeposit: `${USER}/bonus/first-deposit`,
  // No feature gate. `{wageringLock, currency, balances, active, history}`.
  bonusBalance: `${USER}/bonus-balance`,
  // Claims every gradual bonus's unlocked part at once.
  bonusBalanceClaim: `${USER}/bonus-balance/claim`,
  // `bonus` feature. `{code}` → `{code, amount, currency, newBalance}`.
  bonusRedeem: `${USER}/bonus/redeem`,
  // Promotions capability. `{amount, currency, claimable, minimum, rate}`.
  rakeback: `${USER}/rakeback`,
  rakebackClaim: `${USER}/rakeback/claim`,
};

/** Fill `:name` segments — `path(ENDPOINTS.verifyReferral, { referralCode })`. */
export function path(template, params = {}) {
  return template.replace(/:([A-Za-z0-9_]+)/g, (match, key) =>
    key in params ? encodeURIComponent(params[key]) : match,
  );
}
