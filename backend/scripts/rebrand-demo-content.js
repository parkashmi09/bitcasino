#!/usr/bin/env node
'use strict';

/**
 * Replace the leftover "iBitPlay" demo content with SmartBet content.
 *
 *   node scripts/rebrand-demo-content.js           # dry run (default): prints what would change
 *   node scripts/rebrand-demo-content.js --apply   # write, in one transaction
 *
 * What it touches (and nothing else):
 *
 *   blogs            the three posts `scripts/seed-data.js` used to write (author "iBitPlay",
 *                    "Demo content — replace before launch" bodies). Each is rewritten to a short
 *                    SmartBet article (welcome, how to get started, responsible gaming), author
 *                    "SmartBet". A post is only rewritten while it still looks like the seed
 *                    (old slug or author "iBitPlay" or a "demo content" body), so a post an
 *                    operator has edited is never overwritten.
 *   currency_payment_details
 *                    the seeded INR demo row (holder "iBitPlay Demo", UPI "demo@upi"): only its
 *                    display name becomes "SmartBet (demo)". NO payment details are invented —
 *                    bank, account, IFSC and UPI stay the obviously fake demo values, and the
 *                    operator must enter the real ones in the admin (Payments) before taking a
 *                    deposit. The script prints that reminder every run while the row is fake.
 *   gift_cards       a description that contradicts the card's real condition: SMARTSPIN25 says
 *                    "Play through 5x" but its condition is a flat $5 wager (`wager_times` is a
 *                    USD amount when the card has no deposit condition). Rewritten only while it
 *                    still reads the seeded text.
 *
 * Idempotent: a second run finds nothing to change. Prints counts and slugs only.
 */

const path = require('path');

const BRAND = 'SmartBet';

/** The new posts, keyed by the seed slug they replace. Bodies are markdown (the blog renders it). */
const POSTS = [
  {
    from: ['welcome-to-ibitplay'],
    slug: 'welcome-to-smartbet',
    title: 'Welcome to SmartBet',
    subheading: 'Casino and sportsbook, one balance.',
    category: 'Announcements',
    description: [
      'SmartBet puts a full casino and a live sportsbook behind one account and one wallet. Deposit once, then move between slots, live tables and the match of the day without transferring a thing.',
      '',
      '## What you get',
      '',
      '- **One balance** for casino and sports, in the currency you choose.',
      '- **Fast crypto and local payments**, with every deposit and withdrawal in your wallet history.',
      '- **Rewards that add up**: daily, weekly and monthly bonuses, rakeback on every bet, and a VIP ladder that unlocks more as you play.',
      '- **A referral programme**: share your link and earn when your friends play.',
      '',
      '## Play on your terms',
      '',
      'Need a deposit limit, a break or self-exclusion? Our support team will set it on your account, no questions asked. SmartBet is for players aged 18 and over.',
      '',
      'Good luck, and enjoy the game.',
    ].join('\n'),
  },
  {
    from: ['how-provably-fair-works'],
    slug: 'how-to-get-started',
    title: 'How to get started on SmartBet',
    subheading: 'From sign-up to your first bet in a few minutes.',
    category: 'Guides',
    description: [
      'New here? Four steps take you from a fresh account to your first spin or bet.',
      '',
      '## 1. Create your account',
      '',
      'Press **Register**, pick a username and a strong password. Got a referral code from a friend? Enter it on the same form.',
      '',
      '## 2. Make a deposit',
      '',
      'Open **Wallet → Deposit**, choose a coin or a local payment method and follow the instructions on screen. Crypto deposits are credited after the network confirms them.',
      '',
      '## 3. Pick a game or a match',
      '',
      'Browse the **Casino** by category or provider, or open the **Sportsbook** for pre-match and live markets. Your balance works in both.',
      '',
      '## 4. Claim your rewards',
      '',
      'Check **Bonus** for daily, weekly and monthly rewards and rakeback, and **Gift cards** for any codes you have received.',
      '',
      '> Before you play, decide on a budget and stick to it. If you would like a deposit limit on your account, ask our support team.',
    ].join('\n'),
  },
  {
    from: ['responsible-gaming'],
    slug: 'responsible-gaming',
    title: 'Responsible gaming at SmartBet',
    subheading: 'Limits, breaks, self-exclusion and where to get help.',
    category: 'Policy',
    description: [
      'Gambling should be entertainment, never a way to make money or escape problems. SmartBet gives you tools to stay in control.',
      '',
      '## Keep it fun',
      '',
      '- Only play with money you can afford to lose.',
      '- Decide on a budget and a time limit before you start.',
      '- Never chase losses.',
      '- Do not play when you are upset, tired or under the influence.',
      '',
      '## Limits, breaks and self-exclusion',
      '',
      'Contact our support team and we will set any of these on your account:',
      '',
      '- **Deposit limit** — daily, weekly or monthly.',
      '- **Time-out** — a short break, from 24 hours to 6 weeks.',
      '- **Self-exclusion** — your account closed for 6 months or longer.',
      '',
      '## Where to get help',
      '',
      'If gambling has stopped being fun, talk to someone. Free, confidential support is available from organisations such as [Gamblers Anonymous](https://www.gamblersanonymous.org), [GamCare](https://www.gamcare.org.uk) and [Gambling Therapy](https://www.gamblingtherapy.org).',
      '',
      'SmartBet is strictly for players aged 18 and over. Read our full [Responsible gaming policy](/responsible-gaming).',
    ].join('\n'),
  },
];

const DEMO_PAYEE = { from: 'iBitPlay Demo', to: `${BRAND} (demo)` };

const GIFT_CARD_TEXT = [{ key: 'SMARTSPIN25', from: "Play through 5x and it's yours.", fromWager: 5 }];

/** Still the seed's row (safe to rewrite)? */
const looksSeeded = (row) =>
  row.author === 'iBitPlay' || /demo content/i.test(row.description || '') || /ibitplay/i.test(row.title || '');

/** Pure planning — what the script would change. Exported for tests. */
function plan({ blogs = [], payees = [], cards = [] }) {
  const bySlug = new Map(blogs.map((b) => [b.slug, b]));
  const posts = [];
  const skipped = [];
  for (const post of POSTS) {
    const target = bySlug.get(post.slug);
    const source = post.from.map((s) => bySlug.get(s)).find(Boolean);
    const row = source && source.slug !== post.slug ? source : target;
    if (!row) continue;
    const same = row.slug === post.slug && row.title === post.title && row.subheading === post.subheading &&
      row.description === post.description && row.author === BRAND && row.category === post.category;
    if (same) continue;
    // Renaming onto a slug another post already holds would break the unique key.
    if (row !== target && target) { skipped.push(`${row.slug} (target slug ${post.slug} is taken)`); continue; }
    if (!looksSeeded(row)) { skipped.push(`${row.slug} (edited by an operator)`); continue; }
    posts.push({ id: row.id, oldSlug: row.slug, ...post });
  }

  const payeeRows = payees.filter((p) => p.account_holder_name === DEMO_PAYEE.from);
  const fakePayees = payees.filter((p) => p.upi_id === 'demo@upi' || /^demo/i.test(p.bank_name || ''));

  const cardRows = [];
  for (const g of GIFT_CARD_TEXT) {
    const c = cards.find((x) => x.unique_key === g.key);
    if (!c || c.description !== g.from) continue;
    const flat = !c.deposit_status && c.wager_status;
    if (!flat) continue;
    const usd = Number(c.wager_times);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    const txt = `Wager $${usd.toFixed(2)} in casino or sports bets and it's yours.`;
    cardRows.push({ id: c.id, key: c.unique_key, description: txt });
  }

  return { posts, skipped, payeeRows, fakePayees, cardRows };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { connect, QueryTypes } = require('@ibitplay/db');
  const { loadEnv, coercers, dbEnvShape, createLogger } = require('@ibitplay/common');

  const logger = createLogger({ name: 'rebrand-demo-content', level: 'warn' });
  const config = loadEnv(
    { ...dbEnvShape, NODE_ENV: coercers.str('development') },
    { serviceDir: path.resolve(__dirname, '..') }
  );

  const db = await connect({ config, logger, domains: ['core', 'admin'] });
  const { sequelize } = db;
  const select = (sql) => sequelize.query(sql, { type: QueryTypes.SELECT });

  try {
    const [blogs, payees, cards] = await Promise.all([
      select('SELECT id, slug, title, subheading, description, author, category FROM blogs'),
      select('SELECT id, coin_type, bank_name, account_holder_name, upi_id FROM currency_payment_details'),
      select('SELECT id, unique_key, description, deposit_status, wager_status, wager_times FROM gift_cards'),
    ]);

    const { posts, skipped, payeeRows, fakePayees, cardRows } = plan({ blogs, payees, cards });

    console.log(`database:                     ${config.DB_NAME}`);
    console.log(`mode:                         ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}`);
    console.log(`blog posts to rebrand:        ${posts.length}${posts.length ? `  (${posts.map((p) => `${p.oldSlug} → ${p.slug}`).join(', ')})` : ''}`);
    if (skipped.length) console.log(`blog posts left alone:        ${skipped.length}  (${skipped.join(', ')})`);
    console.log(`demo payee names to rename:   ${payeeRows.length}`);
    console.log(`gift card texts to fix:       ${cardRows.length}${cardRows.length ? `  (${cardRows.map((c) => c.key).join(', ')})` : ''}`);

    if (apply && (posts.length || payeeRows.length || cardRows.length)) {
      const result = await db.transaction(async (transaction) => {
        let p = 0, u = 0, g = 0;
        for (const post of posts) {
          const [, meta] = await sequelize.query(
            `UPDATE blogs SET slug = :slug, title = :title, subheading = :subheading, description = :description,
                    author = :author, category = :category, updated_at = now()
              WHERE id = :id`,
            { replacements: { ...post, author: BRAND }, transaction }
          );
          p += meta?.rowCount ?? 0;
        }
        if (payeeRows.length) {
          const [, meta] = await sequelize.query(
            'UPDATE currency_payment_details SET account_holder_name = :to, updated_at = now() WHERE id IN (:ids)',
            { replacements: { to: DEMO_PAYEE.to, ids: payeeRows.map((r) => r.id) }, transaction }
          );
          u = meta?.rowCount ?? 0;
        }
        for (const c of cardRows) {
          const [, meta] = await sequelize.query(
            'UPDATE gift_cards SET description = :description WHERE id = :id',
            { replacements: c, transaction }
          );
          g += meta?.rowCount ?? 0;
        }
        return { p, u, g };
      });
      console.log(`blog posts updated:           ${result.p}`);
      console.log(`payee names updated:          ${result.u}`);
      console.log(`gift card texts updated:      ${result.g}`);
    }

    if (fakePayees.length) {
      console.log('');
      console.log(`NOTE: ${fakePayees.length} manual payment row(s) still carry DEMO bank/UPI details (e.g. demo@upi).`);
      console.log('      They are not real. Enter the real UPI / bank details in the admin (Payments) before taking a deposit.');
    }
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = { plan, POSTS };
