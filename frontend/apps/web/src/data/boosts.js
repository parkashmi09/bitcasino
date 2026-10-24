/**
 * The player's Casino Boosts.
 *
 * STATIC, like `rewards.js`, `notifications.js` and `loyalty.js`, and for the
 * same reason: the platform in `backend/` has no bonus service. Nothing in
 * `lib/endpoints.js` answers a boost list, an activation or a boost reward —
 * the nearest thing is `modules/club`, which is the affiliate club rather than
 * a player bonus.
 *
 * This is the seam. When a bonus service lands, add its paths to
 * `lib/endpoints.js`, read them in `Boosts.jsx`, and delete this file. Rows
 * take the shape below either way:
 *
 *   id            stable key
 *   percentage    the boost, as a number — `10` renders `10%`
 *   eligible      what the boost applies to, in the reference's own words
 *   categorySlug  the category `Choose a game` opens, or absent for none.
 *                 Must be a slug `data/catalog.js` actually has, or the card
 *                 links to a 404
 *   durationMin   the active period once started, in minutes
 *   maxReward     the cap, already formatted, e.g. `10.00 USDT`. A STRING,
 *                 not a number: these are NUMERIC(30,8) on the platform and a
 *                 JSON number cannot carry that — the same rule the wallet
 *                 balances follow
 *   expiresAt     ISO date. The card prints it, and `Boosts.jsx` drops the row
 *                 once it is past, which is how the empty state is reached
 *
 * ## What the fields mean
 *
 * All of it is the reference's own model, from its help centre: a boost
 * multiplies your winnings by `percentage` for `durationMin` minutes once you
 * start it, on `eligible` games, up to `maxReward`. The timer stops at zero or
 * at the cap, whichever comes first.
 *
 * The activation itself is **not here and not on this page**. On the reference
 * a boost starts from the button beside the timer under a boost-compatible
 * game, not from the account area — which is why the card's action is a link
 * into the eligible category rather than an `Activate` button that would have
 * to invent a running timer with nothing behind it.
 */
export const BOOSTS = [
  {
    id: 'slots-10',
    percentage: 10,
    eligible: 'Any slot game',
    categorySlug: 'video-slots',
    durationMin: 2,
    maxReward: '10.00 USDT',
    expiresAt: '2027-06-01',
  },
];

/**
 * `Read more` on the reference opens
 * `/help-center/help-your-bonuses/casino-boosts`. This project has no help
 * centre, so rather than point the button at a route that does not exist, the
 * article's substance sits on the page behind a disclosure and `Read more`
 * opens it.
 *
 * The wording is condensed from that article — see `docs/07-assets.md`, which
 * records the copy taken from the reference along with the artwork.
 */
export const BOOST_EXPLAINER = [
  'A Casino Boost raises your winnings during the boost period by the percentage on the card. While a boost is available you will also see it on the start page, with the percentage, the time left and the games it covers.',
  'The boost period starts when you press the button beside the timer under a boost-compatible game. From then on every win you score counts towards the boost reward.',
  'The timer stops when it reaches zero, or as soon as the maximum boost amount is reached — whichever happens first. A 10% boost on a 30.00 USDT win pays 3.00 USDT; the same boost on a 300.00 USDT win pays the cap, not 30.00.',
];
