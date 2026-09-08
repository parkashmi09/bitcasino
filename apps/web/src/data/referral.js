/**
 * The copy on `/profile/refer-a-friend` — the three steps, the prize table and
 * the FAQ, in the reference's own wording.
 *
 * STATIC, and unlike `rewards.js` or `boosts.js` this one is not a seam
 * standing in for a missing service. The page's *numbers* are real (see
 * `hooks/useReferral`); what is here is the programme's terms, which are
 * editorial content on the reference too — its own FAQ is served from a CMS
 * this project does not have. When a content service lands, this file is what
 * it replaces.
 *
 * The reward figures are the reference's published ones. They describe an
 * offer this project does not run, and are here for the same reason the auth
 * screens carry the reference's marketing copy: `docs/07-assets.md` records
 * both, and says what has to be replaced before this goes anywhere real.
 */

/** The `How does it work?` band: three numbered steps. */
export const REFERRAL_STEPS = [
  {
    title: 'Share your invite link.',
    body: "Refer a friend who's new to Bitcasino and make sure they use your link to register.",
  },
  {
    title: 'Level Up & Receive',
    body: '30-day progression starts immediately after the referred user has created an account.',
  },
  {
    title: 'Get 5,000 USDT',
    body: "Your friend's activity level will determine your reward.",
  },
];

/**
 * The eight reward tiers, from the `What are the prizes?` answer.
 *
 * `points` and `reward` are strings, not numbers: the reference prints them
 * grouped (`1,500,000`) and with the currency attached, and formatting them
 * back from numbers would only be a way of arriving at these exact strings.
 */
export const REFERRAL_TIERS = [
  { level: 'Level 1', points: '2,500 points', reward: '25 USDT' },
  { level: 'Level 2', points: '10,000 points', reward: '50 USDT cash' },
  { level: 'Level 3', points: '25,000 points', reward: '75 USDT cash' },
  { level: 'Level 4', points: '50,000 points', reward: '125 USDT cash' },
  { level: 'Level 5', points: '100,000 points', reward: '200 USDT cash' },
  { level: 'Level 6', points: '500,000 points', reward: '1,000 USDT cash' },
  { level: 'Level 7', points: '1,500,000 points', reward: '2,500 USDT cash' },
  { level: 'Level 8', points: '3,000,000 points', reward: '5,000 USDT cash' },
];

/**
 * The FAQ, in the reference's order.
 *
 * `body` is an array of paragraphs. The second question's answer is the prize
 * table, so it carries `table: true` and the page renders `REFERRAL_TIERS`
 * under its one paragraph — a table in a data file would be the table's
 * markup living somewhere it cannot be styled.
 *
 * The reference shows the first three and hides the rest behind `Show more`,
 * which is why the order matters.
 */
export const REFERRAL_FAQ = [
  {
    question: 'How does the Refer a Friend system work?',
    body: [
      'A registered player can generate a referral link on the Refer a Friend page and send the link to a friend who does not already have an account on Bitcasino.',
      'The referred friend needs to register through this referral link.',
      'After registration, the referrer will see a 30-day progress bar on the Refer a Friend page.',
      'The final referral reward is determined by how many points the referred friend earns in the first 30 days after registration.',
      'The referred friend gets 1 point per every 1 USDT wagered.',
      'The referral reward will only be given to the referrer. The referred friend will enjoy welcome offers and all other promotions dedicated to new customers.',
    ],
  },
  {
    question: 'What are the prizes?',
    body: [
      'The reward is determined by the amount of points the referred friend earns in the first 30 days after registration:',
    ],
    table: true,
  },
  {
    question: 'When will I get my reward?',
    body: [
      'The reward will be released 30 days after the referred friend creates their account and after the necessary reviews/checks are completed.',
    ],
  },
  {
    question: 'How many friends can I refer?',
    body: ['There’s no limit to the number of friends you can refer.'],
  },
  {
    question: 'Can I refer a family or household member?',
    body: ['No, the referred friend must have a different IP address from you.'],
  },
  {
    question: 'Can I refer a friend with an existing account who hasn’t made a deposit?',
    body: ['No, only new registrations through the referral link will be considered valid.'],
  },
];

/** How many questions show before `Show more` — the reference's own three. */
export const REFERRAL_FAQ_VISIBLE = 3;
