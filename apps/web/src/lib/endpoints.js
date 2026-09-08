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
 * Auth is complete; the wallet reads and the player's own game history are the
 * two the signed-in header needs. The rest of the catalogue, wallet and account
 * groups land with their phases (see `docs/10-backend-integration.md`).
 */

const USER = '/api/v1/user';
const CASINO = '/api/v1/casino';

export const ENDPOINTS = {
  // ── Auth ────────────────────────────────────────────────────────────
  // `register` answers 201 with the same session payload `login` returns —
  // one round trip creates the account AND signs it in.
  register: `${USER}/auth/register`,
  login: `${USER}/auth/login`,
  refresh: `${USER}/auth/refresh`,
  logout: `${USER}/auth/logout`,
  me: `${USER}/auth/me`,
  sessions: `${USER}/auth/sessions`,
  changePassword: `${USER}/auth/change-password`,

  // Public: resolves somebody else's referral code before signup submits it.
  verifyReferral: `${USER}/profile/verify-referral/:referralCode`,

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

  // ── Player history ──────────────────────────────────────────────────
  // What the header's `Recents` panel lists. Rows are
  // `{game_uuid, played_at, game}` and `game` is null for a title that has
  // left the catalogue since it was played.
  recentlyPlayed: `${CASINO}/games/recently-played`,
};

/** Fill `:name` segments — `path(ENDPOINTS.verifyReferral, { referralCode })`. */
export function path(template, params = {}) {
  return template.replace(/:([A-Za-z0-9_]+)/g, (match, key) =>
    key in params ? encodeURIComponent(params[key]) : match,
  );
}
