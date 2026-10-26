/**
 * League of Bitcasino — the page over the platform's wager races
 * (`GET /user/race…`, owner feature `races`). Everything with a number in it —
 * the pool, the window, the multipliers, the prize ladder, the board and the
 * player's own place — comes from the API (`pages/League.jsx`). What is here
 * is the copy the backend has no field for, kept free of figures so it cannot
 * contradict what the operator configured.
 */

export const LEAGUE = {
  slug: 'league-of-bitcasino',
  title: 'League of Bitcasino',
  /** The home banner's League art, under a top-anchored crop (see `PromoLayout`). */
  art: '/images/banners/league.png',
  blurb:
    'Wager races: every settled bet climbs the board, and the top places share the prize pool.',
};

/** Title, lede and the body copy under them. */
export const LEAGUE_INTRO = {
  title: 'Climb the board, share the pool',
  lede: 'Every settled bet earns points. When the race window closes, the top of the board shares the prize pool.',
  /** `lead` is set in bold and runs into `text` on the same line. */
  paragraphs: [
    {
      lead: 'Play wide.',
      text: 'Sports, crash games, slots and casino all count — the multiplier table below says what each is worth.',
    },
    {
      lead: 'Nothing to activate.',
      text: 'Every settled wager lands on the board on its own.',
      /** Set on its own line rather than running on from the lead. */
      block: true,
    },
  ],
};

/** The three numbered cards under "Here's the play:". `winners` is the race's own count. */
export const leagueSteps = (winners) => [
  {
    title: 'Every settled wager scores',
    text: 'Win or lose, it lands on the board.',
  },
  {
    title: 'Multipliers by category',
    text: 'Each category scores at its own multiplier, so where you play changes how fast you climb.',
  },
  {
    title: `Top ${winners} share the pool`,
    text: 'When the window closes, the top of the board splits the prize pool.',
  },
];

/** What each race bucket is called on the page; keys are the backend's `multipliers`. */
export const RACE_CATEGORIES = {
  sports: 'Sports',
  crash: 'Crash games',
  slot: 'Slots',
  casino: 'Casino',
  other: 'Other games',
};

/* ----------------------------------------------------- the fine print ---- */

export const LEAGUE_FINE_PRINT = [
  {
    id: 'points',
    heading: 'How points are calculated',
    paragraphs: [
      "Every settled wager is valued in USD and multiplied by its category's multiplier. Cancelled or voided bets do not count.",
      'Prizes are awarded once the race window closes and the board settles.',
    ],
  },
  {
    id: 'general',
    heading: 'General Terms & Conditions',
    items: [
      'By registering, the player agrees to receive emails relating to winnings earned from this promotion.',
      "If a player is involved in any suspicious and/or fraudulent activity, Bitcasino reserves the right to initiate an identity verification process, void the player's bets, exclude the player from the current promotion, ban them from all future promotions, and withhold any winnings from being credited to their account.",
      'If Bitcasino detects fraud, abuse, manipulation of the promotion rules, or any other misuse of the promotion, the player and any associated accounts will be suspended from the current and all future promotions.',
      'Bitcasino reserves the right to amend, suspend or cancel this promotion at any time. These Terms & Conditions are supplementary to the Bitcasino General Terms & Conditions and Bonus Terms & Conditions.',
      'This offer cannot be used in conjunction with any other offer.',
      'All other Bitcasino Terms & Conditions apply.',
      'This offer is limited to one per user, IP address, electronic device, household, residential address, telephone number, payment method, email address, and any public environment where computers and IP addresses are shared, including but not limited to universities, schools, libraries and workplaces. In other words, only one participation is permitted per person.',
      'These Terms & Conditions may be published in multiple languages for information purposes and to improve accessibility for players. The English version is the only legally binding version governing the relationship between you and us. In the event of any discrepancy between the English version and any translation, the English version of these Terms & Conditions shall prevail.',
    ],
  },
];
