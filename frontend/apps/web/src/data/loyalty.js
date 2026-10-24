/**
 * The loyalty standing the account menu's card draws.
 *
 * This is STATIC, like `catalog.js` and for the same reason: the platform in
 * `backend/` has no loyalty service. `modules/club` is the affiliate club, not
 * a player tier, and nothing in `lib/endpoints.js` answers a tier, a
 * multiplier or a points balance. The reference puts all four in a card at the
 * top of its account menu and that card is most of the panel's character, so
 * the layout is reproduced against a fixed standing rather than dropped.
 *
 * This is the seam. When a loyalty endpoint lands, add it to
 * `lib/endpoints.js`, read it in `UserMenu` and delete this file — the card
 * takes the same four fields either way.
 *
 * `points`/`target` are the progress bar's two numbers; the reference writes
 * them as `0 / 2800` centred in the track, with the fill inset 2px.
 */
export const LOYALTY = {
  tier: 'Beginner',
  multiplier: 1,
  points: 0,
  target: 2800,
};

/**
 * The `/loyalty` landing page's content, in the reference's order and wording.
 *
 * All of it is static because all of it is static there too: the page is the
 * Loyalty Club's marketing sheet, identical for every visitor, and the only
 * per-account thing on it is which tier you are on — which `LOYALTY` above
 * already carries. When a loyalty endpoint lands, `LOYALTY` is the piece that
 * starts moving; the tables below stay where they are.
 *
 * Copy and artwork are the reference's, taken with the same explicit request
 * that took the auth screens. `docs/07-assets.md` records that, and says what
 * has to be replaced before this goes anywhere real.
 */

/** Hero strip: the three promises under the banner, with the arrows between. */
export const LOYALTY_PROMISES = [
  { title: 'Fun', body: 'Cashback and free spins on your favourite games', art: '/images/loyalty/fun.webp' },
  { title: 'Fast', body: 'Instant rewards & points multipliers', art: '/images/loyalty/fast.webp' },
  { title: 'Fair', body: 'Real money rewards for everybody & no wagering requirement', art: '/images/loyalty/fair.webp' },
];

/** "6 Benefits of the Loyalty Club" — three across at `xl`, a scroller below. */
export const LOYALTY_BENEFITS = [
  { title: 'Levels & Rewards', body: 'Join a grand adventure of 7 levels and unlimited milestone rewards', art: '/images/loyalty/benefit-0.webp' },
  { title: 'Valuable Progress', body: 'The more you wager the better the benefits.', art: '/images/loyalty/benefit-1.webp' },
  { title: 'Points for every spin', body: 'Play now and earn points for every single spin!', art: '/images/loyalty/benefit-2.webp' },
  { title: 'Exclusive Discounts', body: 'A generous cashback is waiting just for you', art: '/images/loyalty/benefit-3.webp' },
  { title: 'Favourite Slots & Table games.', body: 'Play all your favourite slots & table games', art: '/images/loyalty/benefit-4.webp' },
  { title: 'Dynamic Rewards', body: 'Free spin packages generated based on your gameplay.', art: '/images/loyalty/benefit-5.webp' },
];

/**
 * The seven tiers.
 *
 * `points` and `multiplier` are strings, not numbers: the reference prints
 * them verbatim — `3750000 - ...` for the open-ended top tier, `1.25X` for a
 * fractional multiplier — and formatting them from numbers would only be a
 * way of arriving back at these exact strings.
 *
 * `milestones` is absent on Beginner because the reference omits the whole row
 * there rather than writing "0 milestone rewards".
 *
 * `name` is what `LOYALTY.tier` is matched against to mark the current tier.
 */
export const LOYALTY_TIERS = [
  { name: 'Beginner', points: '0 - 4', multiplier: '1X', art: '/images/loyalty/tier-beginner.png' },
  { name: 'Fan', points: '5 - 3749', multiplier: '1X', milestones: '1 milestone reward', art: '/images/loyalty/tier-fan.png' },
  { name: 'Expert', points: '3750 - 29999', multiplier: '1X', milestones: '6 milestone rewards', art: '/images/loyalty/tier-expert.png' },
  { name: 'Master', points: '30000 - 249999', multiplier: '1.25X', milestones: '12 milestone rewards', art: '/images/loyalty/tier-master.png' },
  { name: 'Guru', points: '250000 - 749999', multiplier: '1.5X', milestones: '11 milestone rewards', art: '/images/loyalty/tier-guru.png' },
  { name: 'Legend', points: '750000 - 3749999', multiplier: '2X', milestones: '12 milestone rewards', art: '/images/loyalty/tier-legend.png' },
  { name: 'Hero', points: '3750000 - ...', multiplier: '3X', milestones: 'Unlimited milestone rewards', art: '/images/loyalty/tier-hero2.png' },
];

/**
 * "Enjoy these Profits" — a three-item list beside one illustration. Picking an
 * item swaps the picture, which is why the art belongs to the item.
 */
export const LOYALTY_PROFITS = [
  { title: 'Play more, gain more', body: 'All rewards are adjusted to your gameplay.', art: '/images/loyalty/profits-1.webp' },
  { title: 'No wagering requirement', body: 'All rewards are real money with no wagering', art: '/images/loyalty/profits-2.webp' },
  { title: 'Completely personalised', body: 'All rewards are created dynamically to fit your play style', art: '/images/loyalty/profits-3.webp' },
];

/**
 * "Your level progress" — four bullet cards. `tone` is a palette token name
 * rather than a class, because Tailwind cannot see a class built by
 * concatenation; the page maps these to full class strings.
 */
export const LOYALTY_PROGRESS = [
  {
    title: 'Loyalty points',
    tone: 'piccolo',
    points: [
      'You earn loyalty level points with every real money bet',
      'Receive points from playing both Slot and Table games',
    ],
  },
  {
    title: 'Points contribution',
    tone: 'krillin',
    points: [
      'Increase your points multiplier with each loyalty level',
      'Higher bet levels earn more points',
    ],
  },
  {
    title: 'Milestone rewards',
    tone: 'cell',
    points: [
      'Tailor made milestone rewards specifically for you',
      'Get free bets in your favourite games',
    ],
  },
  {
    title: 'Cashback',
    tone: 'whis',
    points: [
      'You can get cashback in any level',
      'Claim your cashback at every milestone',
    ],
  },
];
