/**
 * The copy on `/profile/refer-a-friend` — the three steps, the FAQ and the
 * terms dialog. The prize table is the site admin's `referralUnlocks`
 * (`GET /admin/site-config/public`), drawn by the page.
 *
 * STATIC, and unlike `rewards.js` or `boosts.js` this one is not a seam
 * standing in for a missing service. The page's *numbers* are real (see
 * `hooks/useReferral`); what is here is the programme's terms, which are
 * editorial content on the reference too — its own FAQ is served from a CMS
 * this project does not have. When a content service lands, this file is what
 * it replaces.
 *
 * The copy carries no figures, so it cannot contradict the operator's table.
 */

/** The `How does it work?` band: three numbered steps. */
export const REFERRAL_STEPS = [
  {
    title: 'Share your invite link.',
    body: "Refer a friend who's new to Bitcasino and make sure they use your link to register.",
  },
  {
    title: 'Level Up & Receive',
    body: 'Every level your friend wagers through unlocks the next reward for you.',
  },
  {
    title: 'Get rewarded',
    body: "Your friend's activity level will determine your reward.",
  },
];

/**
 * The FAQ, in the reference's order.
 *
 * `body` is an array of paragraphs. The second question's answer is the prize
 * table, so it carries `table: true` and the page renders the site's `referralUnlocks` tiers
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
      'Your reward is unlocked level by level as the referred friend’s total wager grows.',
      'The referral reward will only be given to the referrer. The referred friend will enjoy welcome offers and all other promotions dedicated to new customers.',
    ],
  },
  {
    question: 'What are the prizes?',
    body: [
      'Each level of your friend’s total wager unlocks a reward:',
    ],
    table: true,
  },
  {
    question: 'When will I get my reward?',
    body: [
      'Each reward unlocks as soon as your friend’s total wager reaches its level, and is then yours to claim.',
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

/**
 * The "Referral Terms & Conditions" dialog opened from the banner's consent
 * line — the reference's own terms, in the reference's own wording.
 *
 * Each clause is an ordered-list entry. Two are objects rather than strings:
 * one carries `table: true`, which the dialog answers with the prize table
 * (the reference numbers straight through it, so the list renders in two runs
 * around the table), and one carries a `link` to the reward terms page in this
 * app, which the reference holds as a link of its own.
 */
export const REFERRAL_TERMS = {
  intro:
    'These terms and conditions ("Terms") govern the Bitcasino Refer a Friend Program ("Program"). By participating in the Program, you agree to be bound by these Terms and any additional terms and conditions provided by Bitcasino.',
  sections: [
    {
      heading: 'Program Overview',
      items: [
        'A registered Bitcasino user ("Referrer") may generate a unique referral link through the \'Refer a Friend\' page.',
        'Referrals are exclusively available to individuals who have not previously registered an account with Bitcasino and are classified as new users ("Referee"). Existing accounts without a deposit are not considered new users and hence, cannot be referred.',
        "Registration must be completed using the referral link provided by the Referrer; otherwise, the progress won't be considered for the referral reward.",
        'The Referrer can refer an unlimited number of users and will be able to monitor the progress of each Referee.',
        'Each user is limited to one account per IP address. If the Referrer and the Referee share the same IP, the Referrer is not eligible to receive a reward.',
        "The Referrer will have access to a dedicated dashboard within their Bitcasino account, specifically in the 'Refer a Friend' section, listing every Referee.",
        'Rewards are not cumulative.',
        "Rewards unlock as the Referee's total wager reaches each level.",
        {
          before: 'Wagering on restricted games mentioned in the ',
          link: { to: '/help-center/reward-terms', label: 'Reward Terms and Conditions' },
          after: ' will not contribute to this Program.',
        },
        "Rewards are based on the Referee's total wager, with each level unlocking the reward detailed below:",
        { table: true },
        'Bitcasino reserves the right to modify and adjust the reward levels as deemed appropriate.',
        'Only the Referrer is entitled to receive the Refer-a-friend reward. The Referee will enjoy welcome offers and all other promotions dedicated to new customers.',
        'The reward will be released upon successfully passing the required validation checks, and the referral status will be visible in the dashboard.',
        'Affiliates of Bitcasino and affiliated platforms who are on a lifetime Net Gaming Revenue (NGR) share arrangement are not permitted to participate in the Program and, as such, are not eligible for the Refer-a-friend reward.',
      ],
    },
    {
      heading: 'General Terms',
      items: [
        'Bitcasino reserves the right to modify or terminate the Program, including these Terms, at any time without notice.',
        'Bitcasino may disqualify any participant for any fraudulent activity or violation of these Terms.',
        'Participants agree to comply with all applicable laws and regulations.',
        'These Terms are subject to the laws of Curacao. Any disputes arising out of or in connection with this Program shall be resolved in the courts of Curacao.',
        "By participating in the Program as a Referee, you consent to your wager amount of data being utilized to calculate your referee's prize level.",
        'By participating in the Program, participants agree to receive communications from Bitcasino related to the Program.',
      ],
    },
  ],
};
