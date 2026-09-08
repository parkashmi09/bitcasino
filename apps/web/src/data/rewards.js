/**
 * The player's rewards, and the codes the claim dialog accepts.
 *
 * STATIC, like `notifications.js` and `loyalty.js`, and for the same reason:
 * the platform in `backend/` has no bonus service. Nothing in
 * `lib/endpoints.js` answers a reward list, an enable call or a code
 * redemption — the nearest thing is `modules/club`, which is the affiliate
 * club rather than a player bonus.
 *
 * This is the seam. When a bonus service lands, add its paths to
 * `lib/endpoints.js`, read them in `useRewards`, and delete this file. Rows
 * take the shape below either way:
 *
 *   id           stable key, and what the enabled set in `useRewards` stores
 *   title        the card's heading — the offer's own name
 *   description  one line under it; the reference does not mark any of it up
 *   notice       the line in the white callout, or absent for no callout
 *   minDeposit   already formatted, e.g. `50.00 USDT`. A STRING, not a number:
 *               these are NUMERIC(30,8) on the platform and a JSON number
 *               cannot carry that — same rule the wallet balances follow
 *   expiresAt    ISO date. Rendered `01/06/2027`; see `Rewards.jsx`
 *   reward       what is actually granted, printed under a `Reward` caption.
 *                Usually the title again, which is what the reference shows
 *   termsHref    where `Terms & Conditions` goes
 *
 * The card's `Deposit` button opens the same drawer the header's does, so a
 * reward with `minDeposit` needs no route of its own.
 */
export const REWARDS = [
  {
    id: 'welcome-100',
    title: 'Welcome to Bitcasino – 100% up to 1,500 USDT (WR 30x)',
    description:
      'The reward needs to be wagered 30 times before you can make a withdrawal.',
    notice: 'Enable your bonus first, then make a deposit.',
    minDeposit: '50.00 USDT',
    expiresAt: '2027-06-01',
    reward: 'Welcome to Bitcasino – 100% up to 1,500 USDT (WR 30x)',
    termsHref: '/terms',
  },
];

/**
 * What `Claim reward` accepts, keyed by the code as typed (matched
 * case-insensitively and trimmed — a code arrives off a promo email or a
 * banner, and `  reload50 ` is the same code as `RELOAD50`).
 *
 * Fixture data, exactly like `GAMES` in `catalog.js`. A dialog that rejects
 * every code would be a validation result we invented just as much as one
 * that accepts some, and a claim flow nobody can complete cannot be checked
 * against the reference at all. The redemption is local: `useRewards` keeps
 * the claimed ids in `localStorage` beside the enabled ones, which is also
 * the shape a real `POST /rewards/claim` would leave behind.
 */
export const CLAIM_CODES = {
  RELOAD50: {
    id: 'reload-50',
    title: 'Midweek Reload – 50% up to 500 USDT (WR 25x)',
    description:
      'The reward needs to be wagered 25 times before you can make a withdrawal.',
    notice: 'Enable your bonus first, then make a deposit.',
    minDeposit: '20.00 USDT',
    expiresAt: '2026-12-31',
    reward: 'Midweek Reload – 50% up to 500 USDT (WR 25x)',
    termsHref: '/terms',
  },
  FREESPINS: {
    id: 'free-spins-100',
    title: '100 Free Spins on Sweet Bonanza (WR 40x)',
    description:
      'Winnings from the spins need to be wagered 40 times before you can make a withdrawal.',
    minDeposit: '10.00 USDT',
    expiresAt: '2026-11-30',
    reward: '100 Free Spins on Sweet Bonanza',
    termsHref: '/terms',
  },
};
