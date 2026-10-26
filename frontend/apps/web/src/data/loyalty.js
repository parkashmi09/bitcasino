/**
 * The `/loyalty` landing page's marketing copy, in the reference's order and
 * wording — identical for every visitor, with no platform equivalent.
 *
 * The per-account parts are live: the tiers are the platform's VIP ladder and
 * the standing is the player's (`queries/rewards.js`), read by `Loyalty.jsx`
 * and the account menu's card.
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
