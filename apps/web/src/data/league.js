/**
 * League of Bitcasino — the campaign behind the home banner's first card.
 *
 * Static, like `PROMOTIONS` and `HOME_BANNERS` in `catalog.js` and like
 * `TOURNAMENTS`, and for the same reason: **there is no promotions endpoint on
 * this platform.** `admin/banners` serves a picture and a placement name and
 * nothing else (see the block at the top of `HomeBanner.jsx`), `GET
 * /user/bonus/events` is the caller's own paid-bonus log (see `Promotions.jsx`),
 * and no table anywhere carries a campaign's copy, its prize ladder or a
 * leaderboard. So this file is the shape a campaign read would fill, not a
 * shape invented for the view: every field below is one the reference's own
 * page renders.
 *
 * The copy is the reference's, transcribed — the same treatment
 * `data/referral.js` gives the refer page, and for the same reason: a clone of
 * a marketing page whose words are reworded is no longer a comparison you can
 * run in two tabs. Two deliberate departures:
 *
 * 1. **The leaderboard rows are ours.** The reference's are real players,
 *    masked. Copying a hundred rows of somebody's play history — even masked —
 *    is not a thing to keep in a repository, so the board below is generated
 *    from a fixed seed: the same 100 rows every load, nobody's account behind
 *    any of them. `TOURNAMENTS[].leader` already does this on a smaller scale.
 * 2. **The boost column uses the multiplier table's own values.** The
 *    reference's board prints 1.15 and 1.35 beside a table saying the only
 *    multipliers are 1.00x, 1.30x and 1.60x. That is a live inconsistency in
 *    their data; reproducing it in numbers we are making up anyway would be
 *    copying a bug rather than a design.
 *
 * `WEEK` is fixed at 4 rather than derived from the campaign window, because
 * the intro copy is written for the final week ("It all comes down to Week 4",
 * "your last chance"). A real integration serves the week and the copy from the
 * same row, and neither is a constant then.
 */

/** Which weekly round the transcribed copy is from. See the note above. */
const WEEK = 4;

/** Masked exactly as the reference masks a leaderboard alias: `Man******1`. */
const MASK = '******';

export const LEAGUE = {
  slug: 'league-of-bitcasino',
  title: 'League of Bitcasino',
  /**
   * The reference's detail hero is a 2800x1160 render of the same artwork the
   * home banner card already carries — and that file is in this tree at
   * `banners/league.png`, a 992x1028 crop whose whole subject sits in the top
   * 40% of the frame. So the hero re-uses it under a top-anchored cover crop
   * rather than adding a second 795 KB PNG of the same panda to `public/`. See
   * `docs/07-assets.md` for where the file came from.
   */
  art: '/images/banners/league.png',
  /** The reference's own promotion card, word for word — trailing dot and all. */
  blurb:
    '50,000 USDT every week. Cover Video Slots, Live Casino and Bitcasino Originals to score up to 1.60x in boosts..',
  week: WEEK,
  weeklyPool: '50,000 USDT',
  finalPool: '50,000 USDT',
  /** The campaign window, as the terms state it. */
  runs: { from: '17 August 2026', to: '13 September 2026' },
};

/** Title, lede and the body copy under them. */
export const LEAGUE_INTRO = {
  title: `Week ${WEEK} Is Here, Get into it!`,
  lede: '50,000 USDT is up for grabs this week. Plus, another 50,000 USDT in the Final.',
  /** `lead` is set in bold and runs into `text` on the same line. */
  paragraphs: [
    {
      lead: `It all comes down to Week ${WEEK}.`,
      text: 'The leaderboard has reset for the final weekly round, and every wager starts from zero again. This is your last chance to climb the weekly board alongside a fresh run of releases, round-the-clock live tables and Originals ready whenever you are.',
    },
    {
      lead: 'Cover three categories, score 1.60x.',
      text: 'Video Slots, Live Casino and Bitcasino Originals. Wager 1,000 USDT in a category and it counts. The more ground you cover, the harder your score works.',
    },
    {
      lead: "And don't forget the Final.",
      /**
       * The reference ends this one with a link to the Final's own promotion
       * page. There is no such page here — and one more slug redirecting back
       * to `/promotions` reads as a broken link rather than a destination — so
       * the sentence stands without it.
       */
      text: "Everything you've played throughout the promotion feeds the Final, where a separate 50,000 USDT is up for grabs. Make your final week count.",
    },
    {
      lead: 'Nothing to activate.',
      text: 'Every settled wager lands on the board on its own, and it refreshes hourly.',
      /** Set on its own line rather than running on from the lead. */
      block: true,
    },
  ],
  postscript:
    "P.S. Cash isn't all. Each week, the top 100 also receive free spins on selected games, refreshed monthly.",
};

/** The three numbered cards under "Here's the play:". */
export const LEAGUE_STEPS = [
  {
    title: 'Every settled wager scores',
    text: 'Win or lose, slots or tables, it lands on the board.',
  },
  {
    title: 'Play wide, multiply your score',
    text: 'Wager 1,000 USDT in a category to lock it in. Cover all three and your weekly score climbs to 1.60x.',
  },
  {
    title: 'Top 100 split 50,000 USDT',
    text: 'In this final weekly round, the top 100 divide the full prize pool between them.',
  },
];

/** `Categories covered` against `Multiplier`. */
export const LEAGUE_MULTIPLIERS = [
  { covered: '1', multiplier: '1.00x' },
  { covered: '2', multiplier: '1.30x' },
  { covered: '3', multiplier: '1.60x' },
];

/** `Position` against `Prize (USDT)`, top to bottom of the ladder. */
export const LEAGUE_PRIZES = [
  { position: '1', prize: '10,000' },
  { position: '2', prize: '5,000' },
  { position: '3', prize: '3,000' },
  { position: '4 - 5', prize: '2,000' },
  { position: '6 - 10', prize: '1,000' },
  { position: '11 - 20', prize: '500' },
  { position: '21 - 40', prize: '300' },
  { position: '41 - 100', prize: '200' },
];

/* --------------------------------------------------------- the board ----- */

/** Deterministic PRNG, so the hundred rows below are the same on every load. */
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weighted towards lowercase letters, because usernames are: an alphabet with
 * one weight for all 62 characters produces `RF7******E`, which reads as a
 * licence plate rather than as the head of somebody's handle.
 */
const ALPHABET =
  'abcdefghijklmnopqrstuvwxyz'.repeat(4) + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + '0123456789'.repeat(2);

/**
 * The top 100, built once at module load.
 *
 * Points fall away from the leader on a jittered decay rather than a clean
 * curve — a board where every gap is the same size is the one thing that reads
 * as fake at a glance. The decay is in two phases because the reference's own
 * board is: the top twenty shed most of the leader's total (1.12M down to
 * ~100k), and the eighty below them slide gently to ~14k. One rate for all 100
 * either flattens the head or wipes out the tail.
 *
 * The three boost values are drawn with the weighting the reference's board
 * shows: most players cover one category, a few cover all three.
 */
function buildBoard() {
  const random = mulberry32(0x1ea6);
  const pick = () => ALPHABET[Math.floor(random() * ALPHABET.length)];
  const rows = [];
  let points = 1_115_809;

  for (let position = 1; position <= 100; position += 1) {
    const alias = pick() + pick() + pick() + MASK + pick();
    const draw = random();
    const boost = draw > 0.93 ? '1.60' : draw > 0.78 ? '1.30' : '1.00';

    rows.push({ position, alias, boost, points: Math.round(points) });
    points *= position < 20 ? 0.85 + random() * 0.062 : 0.96 + random() * 0.031;
  }

  return rows;
}

export const LEAGUE_BOARD = buildBoard();

/** Everyone in the week's race, not just the hundred on the board. */
export const LEAGUE_PLAYERS = 3103;

/**
 * When the board last refreshed.
 *
 * Resolved at render and floored to the hour, because the page says the board
 * refreshes hourly and a timestamp contradicting the page's own copy is worse
 * than no timestamp at all. The reference prints GMT, so this formats in UTC.
 */
export function leagueUpdatedAt(now = new Date()) {
  const hour = new Date(now);
  hour.setUTCMinutes(0, 0, 0);
  const pad = (value) => String(value).padStart(2, '0');

  return (
    `${hour.getUTCFullYear()}-${pad(hour.getUTCMonth() + 1)}-${pad(hour.getUTCDate())} ` +
    `${pad(hour.getUTCHours())}:00:00 GMT`
  );
}

/* ----------------------------------------------------- the fine print ---- */

/**
 * Everything below the board, which the reference folds into one collapsed
 * card: how a wager becomes a point, then the two sets of terms.
 *
 * `paragraphs` are prose, `bullets` a disc list and `items` a numbered one —
 * which is how the reference sets each of the three sections.
 */
export const LEAGUE_FINE_PRINT = [
  {
    id: 'points',
    heading: 'How points are calculated',
    paragraphs: [
      'Every settled wager converts to points based on its theoretical margin, which is the expected gross win on that wager rather than the amount staked.',
    ],
    bullets: [
      {
        lead: 'Casino:',
        text: 'points = stake × theoretical margin, where theoretical margin = (100 − RTP) ÷ 100.',
      },
    ],
    footnote:
      'This means a wager is worth what it is actually worth. Games with a higher RTP generate proportionally fewer points per unit staked.',
  },
  {
    id: 'campaign',
    heading: 'Campaign Terms & Conditions',
    items: [
      'The League of Bitcasino promotion runs from 17 August 2026 to 13 September 2026.',
      'Open to all eligible global players on Bitcasino.',
      'Four (4) weekly competitions will take place during the promotion, each with a 50,000 USDT prize pool.',
      'Each weekly competition runs from 00:00 UTC on Monday to 23:59 UTC on Sunday. The leaderboard resets at the start of each new week.',
      'Players who qualify across multiple weeks will be eligible to compete for the 50,000 USDT League of Bitcasino Final prize pool, subject to the promotion rules.',
      'No opt-in is required. All eligible players are entered automatically.',
      'Casino: The minimum qualifying wager is the minimum stake permitted within each eligible game.',
      'Eligible Casino Games: Only wagers placed on eligible casino games will generate leaderboard points. Eligible games include Live Baccarat, Live Blackjack, Live Dealer, Live Dice, Live Game Shows, Live Games, Live Keno, Live Lottery, Live Poker, Live Roulette, Video Slots, Jackpot Slots and Bitcasino Originals. Wagers placed on any other game categories or game providers will not generate leaderboard points.',
      'Every qualifying casino wager earns leaderboard points, whether it wins or loses.',
      "Multiplier: A player's weekly points total is multiplied according to how many of the three qualifying categories the player was active in during that week. The three categories are Video Slots, Live Casino and Bitcasino Originals.",
      'Multiplier values: one category 1.00x, two categories 1.30x, three categories 1.60x. A category counts as played where the player has at least 1,000 USDT or equivalent qualifying settled wager in that category during the relevant week.',
      'The multiplier applies to the weekly leaderboard only. It does not apply to the League of Bitcasino Final standings.',
      "The multiplier is recalculated at each leaderboard refresh and is based on that week's activity only. No activity carries over between weeks.",
      "Weekly leaderboards are ranked on the player's multiplied points total.",
      "Only wagers settled during the relevant week will count towards that week's leaderboard.",
      'Weekly leaderboards update hourly and reset at the start of each new week.',
      'The Top 100 players on each weekly leaderboard will receive prizes according to the applicable weekly prize structure.',
      'Weekly prizes and Final prizes will be credited after leaderboard verification.',
      'Bitcasino reserves the right to amend, suspend or cancel this promotion at any time.',
      'Standard Bitcasino Terms & Conditions apply.',
      '18+ | Please gamble responsibly.',
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
