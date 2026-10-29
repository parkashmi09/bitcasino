/**
 * What the owner can entitle this site to — contract §2.
 *
 * `features` mirror the backend feature catalogue
 * (backend/packages/common/src/featureCatalogue.js — keys, labels, variants and their generic
 * descriptions copied; the backend's internal `builtFor` is never copied). The owner sets each
 * feature's ON/OFF and VARIANT here; the site admin only shows them (contract §2, §4).
 * `flags` mirror the siteconfig columns, grouped as in the hub owner-admin's flagGroups.ts.
 *
 * Keys are a contract with the backend: add, never rename. A key missing from the
 * stored document reads as on, so adding one here never breaks a live site.
 */

export type VariantEntry = { key: string; label: string; description: string }

export type FeatureEntry = {
  key: string
  label: string
  category: string
  flag: string | null

  /** Business policy (business model, deposits, withdrawals): always on; its variant IS the policy. */
  policy?: boolean
  defaultVariant?: string

  /** The ways the site can offer it. `none` = off. */
  variants: VariantEntry[]

  /** A line shown under a policy row on "Features & plan" (what the choice means for the site). */
  note?: string
}

export type FlagGroup = { title: string; description: string; keys: string[] }

/**
 * The coins the owner may pick as the site's reward currency. Mirrors
 * `REWARD_CURRENCY_CHOICES` / `REWARD_CURRENCY_NAMES` in backend/packages/common/src/currencies.js
 * (built-in wallet coins the wallet can credit, minus retired BJB and the NC test coin);
 * scripts/rewardCurrency.test.mjs asserts the two lists match. Order = the dropdown's order.
 */
export const REWARD_CURRENCIES: { code: string; name: string }[] = [
  { code: 'USDT', name: 'Tether (US dollar)' },
  { code: 'USDC', name: 'USD Coin' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'EUR', name: 'Euro' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'BDT', name: 'Bangladeshi taka' },
  { code: 'MVR', name: 'Maldivian rufiyaa' },
  { code: 'NPR', name: 'Nepalese rupee' },
  { code: 'PKR', name: 'Pakistani rupee' },
  { code: 'BTC', name: 'Bitcoin' },
  { code: 'ETH', name: 'Ether' },
  { code: 'LTC', name: 'Litecoin' },
  { code: 'BCH', name: 'Bitcoin Cash' },
  { code: 'TRX', name: 'Tron' },
  { code: 'DOGE', name: 'Dogecoin' },
  { code: 'ADA', name: 'Cardano' },
  { code: 'XRP', name: 'XRP' },
  { code: 'BNB', name: 'BNB' },
  { code: 'USDP', name: 'Pax Dollar' },
  { code: 'TUSD', name: 'TrueUSD' },
  { code: 'BUSD', name: 'Binance USD' },
  { code: 'NEXO', name: 'Nexo' },
  { code: 'MKR', name: 'Maker' },
  { code: 'SHIB', name: 'Shiba Inu' },
  { code: 'MATIC', name: 'Polygon' },
  { code: 'SC', name: 'Siacoin' }
]

export const REWARD_CURRENCY_NOTE = 'All rewards — VIP, bonuses, rakeback, affiliate, spin wheel — are calculated and paid in this currency.'

/**
 * The default coin's choices — the same wallet coins as the reward currency (backend
 * `DEFAULT_CURRENCY_CHOICES` = `REWARD_CURRENCY_CHOICES` in currencies.js).
 */
export const DEFAULT_CURRENCIES = REWARD_CURRENCIES

export const DEFAULT_CURRENCY_NOTE =
  'The currency money screens open on: site admin Finance pages filter to it first, and players see it first in the deposit dialog. Anyone can still switch.'

const CATALOGUE: FeatureEntry[] = [
  {
    key: 'business_model',
    label: 'Business model',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'hybrid',
    variants: [
      { key: 'b2c', label: 'B2C — direct players', description: 'Anyone may sign up and use the cashier themselves.' },
      { key: 'b2b', label: 'B2B — agent network', description: 'Public sign-up is closed. Players are created by agents in the staff tree and funded by transfer.' },
      { key: 'hybrid', label: 'Hybrid', description: 'Public sign-up is open, and agents may also create and fund players. The default.' }
    ]
  },
  {
    key: 'deposit_mode',
    label: 'Deposits',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'both',
    variants: [
      { key: 'automatic', label: 'Automatic only', description: 'Gateway and crypto deposits, credited by the provider callback. Manual transfer submissions are refused.' },
      { key: 'manual', label: 'Manual only', description: 'The player submits a transfer reference and screenshot; staff approve it. Gateway and crypto deposits are refused.' },
      { key: 'both', label: 'Automatic and manual', description: 'Both routes are open. The default.' },
      { key: 'none', label: 'Closed', description: 'No new deposits. Pending ones can still be approved, and provider callbacks still credit.' }
    ]
  },
  {
    key: 'withdrawal_mode',
    label: 'Withdrawals',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'both',
    variants: [
      { key: 'automatic', label: 'Automatic only', description: 'Paid out by the gateway (needs AUTO_WITHDRAWALS_ENABLED on the backend). Manual requests are refused.' },
      { key: 'manual', label: 'Manual only', description: 'The player requests; the cashier team reviews and pays by hand. Gateway payouts are refused.' },
      { key: 'both', label: 'Automatic and manual', description: 'Both routes are open. The default.' },
      { key: 'none', label: 'Closed', description: 'No new withdrawal requests. Pending ones can still be decided.' }
    ]
  },
  {
    // The reward currency: a policy (always on, owner-only) whose variant keys ARE the coin codes.
    key: 'reward_currency',
    label: 'Reward currency',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'USDT',
    note: REWARD_CURRENCY_NOTE,
    variants: REWARD_CURRENCIES.map(c => ({
      key: c.code,
      label: `${c.code} — ${c.name}`,
      description: `All rewards — VIP, bonuses, rakeback, affiliate, spin wheel — are calculated and paid in ${c.code}.`
    }))
  },
  {
    // The default coin: a policy (always on, owner-only) whose variant keys ARE the coin codes, like the
    // reward currency but separate from it — it only decides what a screen shows first.
    key: 'default_currency',
    label: 'Default coin',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'USDT',
    note: DEFAULT_CURRENCY_NOTE,
    variants: DEFAULT_CURRENCIES.map(c => ({
      key: c.code,
      label: `${c.code} — ${c.name}`,
      description: `Admin Finance screens open filtered to ${c.code}, and players see ${c.code} first in the deposit dialog.`
    }))
  },
  {
    // Region restriction: a policy (always on, owner-only) whose variant is the mode. The list type
    // and countries are the document's `region` (src/lib/entitlements/region.ts).
    key: 'region_restriction',
    label: 'Region restriction',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'none',
    note: 'Which countries the site serves. Notice shows the region popup; Block also refuses sign-up and login (403 REGION_RESTRICTED). Staff login is never affected.',
    variants: [
      { key: 'none', label: 'Off', description: 'Players from every country may visit, sign up and log in. The default.' },
      { key: 'notice', label: 'Notice only', description: 'Visitors from a restricted country see the region notice, which they can dismiss. Sign-up and login stay open.' },
      { key: 'block', label: 'Block', description: 'Visitors from a restricted country see the region notice, and the backend refuses their sign-up and login (403 REGION_RESTRICTED). Staff login is not affected.' }
    ]
  },
  {
    // Withdrawal requirements: a policy (always on, owner-only). `none` here means nothing is
    // required, not "closed". Mirrors backend featureCatalogue.js; enforced by user-service
    // modules/withdraw-requirements on every withdrawal rail. The screen shows it as switches:
    // the variant = KYC × wagering (lib/entitlements/withdrawalCap.ts switchesOf), plus the
    // document's `withdrawalCap` block for the deposit cap.
    key: 'withdrawal_requirements',
    label: 'Withdrawal requirements',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'kyc',
    note: 'What a player must have done before a withdrawal is accepted: any combination of the switches below. Wagering = the deposit rollover and every active bonus (forfeiting a bonus clears its part). Deposit cap = per currency, deposits × multiplier (+ wagering up to its own multiplier) minus what was already withdrawn. Refusals: *_KYC_REQUIRED, 403 WITHDRAW_WAGER_REQUIRED, 403 WITHDRAW_CAP_EXCEEDED.',
    variants: [
      { key: 'none', label: 'No KYC', description: 'KYC is not required to withdraw. The deposit rollover still has to be complete, and an active bonus forfeited (the player confirms).' },
      { key: 'kyc', label: 'KYC verified', description: "The player's KYC must be Verified, and the deposit rollover complete. The default." },
      { key: 'wager', label: 'Wagering complete', description: 'Every open wagering requirement (deposit rollover and active bonuses) must be complete. KYC is not checked. Forfeiting a bonus clears its part.' },
      { key: 'kyc_and_wager', label: 'KYC and wagering', description: 'KYC must be Verified and every open wagering requirement complete.' }
    ]
  },
  {
    // The casino aggregator: a policy (always on, owner-only), no `none`. Mirrors backend
    // featureCatalogue.js. The lobby's catalogue table holds ONE aggregator's games at a time;
    // switching parks the other's (casino-service games/catalogueSwitch.js), so switching back
    // needs no re-fetch.
    key: 'casino_aggregator',
    label: 'Casino games provider',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'js_games',
    note: 'Whose games the casino lobby serves. Only one at a time: the other provider\'s games are parked, not deleted, and come back when you switch back. Slotegrator needs its merchant keys on the backend and a Slotegrator catalogue sync, run from a server IP Slotegrator has whitelisted.',
    variants: [
      { key: 'js_games', label: 'JSGames', description: 'The lobby serves the JSGames catalogue and games launch through JSGames. The default.' },
      { key: 'slotegrator', label: 'Slotegrator', description: 'The lobby serves the Slotegrator catalogue and games launch through Slotegrator. Run the Slotegrator sync to fill it.' }
    ]
  },
  {
    // Light / dark theme: a policy (always on, owner-only). Mirrors backend featureCatalogue.js.
    key: 'theme_mode',
    label: 'Light / dark theme',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'dark_only',
    note: 'Dark only: the player site is always dark and shows no theme toggle. Dark and light: players can switch (sidebar, account page, Settings → Preferences).',
    variants: [
      { key: 'dark_only', label: 'Dark only', description: 'The site is always dark; no theme toggle anywhere. The default.' },
      { key: 'switch', label: 'Dark and light', description: 'Players can switch between the dark and the light theme (sidebar, account page, Settings → Preferences).' }
    ]
  },
  {
    // Admin colour theme: a policy (owner-only), bitcasino + smartbet. Mirrors backend featureCatalogue.js.
    key: 'admin_theme',
    label: 'Admin colour theme',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'same',
    note: 'The site admin\'s colours, apart from the player site\'s template. Same as the site: the admin follows the template. Original: the admin keeps its own colours.',
    variants: [
      { key: 'same', label: 'Same as the site', description: 'The admin takes the template the player site uses. The default.' },
      { key: 'original', label: 'Original', description: 'The admin keeps its own colours whatever the site uses.' },
      { key: 'carbon_gold', label: 'Carbon Gold', description: 'The admin uses the Carbon Gold palette.' },
      { key: 'violet_night', label: 'Violet Night', description: 'The admin uses the Violet Night palette.' },
      { key: 'emerald_dark', label: 'Emerald Dark', description: 'The admin uses the Emerald Dark palette.' },
      { key: 'neon_navy', label: 'Neon Navy', description: 'The admin uses the Neon Navy palette.' },
      { key: 'lapis_ledger', label: 'Lapis Ledger', description: 'The admin uses the Lapis Ledger palette.' },
      { key: 'seashell_teal', label: 'Seashell Teal', description: 'The admin uses the Seashell Teal palette.' },
      { key: 'navy_coral', label: 'Navy Coral', description: 'The admin uses the Navy Coral palette.' },
      { key: 'indigo_mint', label: 'Indigo Mint', description: 'The admin uses the Indigo Mint palette.' },
      { key: 'cobalt_citrine', label: 'Cobalt Citrine', description: 'The admin uses the Cobalt Citrine palette.' },
      { key: 'copper_harbour', label: 'Copper Harbour', description: 'The admin uses the Copper Harbour palette.' },
      { key: 'wisteria', label: 'Wisteria', description: 'The admin uses the Wisteria palette.' },
      { key: 'jade_night', label: 'Jade Night', description: 'The admin uses the Jade Night palette.' },
      { key: 'magma', label: 'Magma', description: 'The admin uses the Magma palette.' },
      { key: 'royal_dusk', label: 'Royal Dusk', description: 'The admin uses the Royal Dusk palette.' },
      { key: 'tangerine_field', label: 'Tangerine Field', description: 'The admin uses the Tangerine Field palette.' },
      { key: 'ocean_ruby', label: 'Ocean Ruby', description: 'The admin uses the Ocean Ruby palette.' }
    ]
  },
  {
    // Slotegrator INR games in PKR: a policy (always on, owner-only). Mirrors backend featureCatalogue.js.
    key: 'slotegrator_inr_as_pkr',
    label: 'Slotegrator: INR games in PKR',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'off',
    note: 'On: a player betting in INR gets the Slotegrator game in PKR; each bet, win and refund is converted PKR → INR at the site rate, and only the INR wallet moves. Off: INR in, INR out. Needs PKR limits on the Slotegrator contract.',
    variants: [
      { key: 'off', label: 'Off', description: 'An INR bet launches the game in INR and settles in INR. The default.' },
      { key: 'on', label: 'On', description: 'An INR bet launches the Slotegrator game in PKR; every bet, win and refund is converted PKR → INR at the site rate and moves the INR wallet.' }
    ]
  },
  {
    // API encryption: a policy (always on, owner-only). Mirrors backend featureCatalogue.js.
    key: 'api_encryption',
    label: 'API encryption',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'off',
    note: 'On: the player site\'s API data travels encrypted (AES-256-GCM) and the site decrypts it. Off: plain JSON. Takes effect within about 15 seconds.',
    variants: [
      { key: 'off', label: 'Off', description: "The player site's API data comes as plain JSON. The default." },
      { key: 'on', label: 'On', description: "The player site's API data comes encrypted (AES-256-GCM) and the site decrypts it." }
    ]
  },
  {
    // Rate limit: a policy (always on, owner-only). Mirrors backend featureCatalogue.js.
    key: 'rate_limit',
    label: 'Rate limit',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'on',
    note: 'On: too many requests from one player or address are refused for a while (limits in the server .env). Off: no limits, except login, password reset, OTP and 2FA, which always stay on. Takes effect within about 15 seconds.',
    variants: [
      { key: 'on', label: 'On', description: 'Too many requests from one player or address are refused for a while. The default.' },
      { key: 'off', label: 'Off', description: 'No request limits, except the login, password reset, OTP and 2FA guards.' }
    ]
  },
  {
    // Branch management: a policy (always on, owner-only). Mirrors backend featureCatalogue.js.
    key: 'branch_management',
    label: 'Branch management',
    category: 'business',
    flag: null,
    policy: true,
    defaultVariant: 'off',
    note: 'On: the Super Admin gets Branch Management (create branches with a login, activate / deactivate, change password, branch reports); each branch signs in at the admin\'s /branch, creates its own players and sees their deposits, withdrawals and play. Off: the screens hide and no branch can sign in. Takes effect within about 15 seconds.',
    variants: [
      { key: 'off', label: 'Off', description: 'No branches: the admin screens hide and no branch can sign in. The default.' },
      { key: 'on', label: 'On', description: 'The Super Admin creates branches; each branch signs in at /branch, creates its own players and sees their deposits, withdrawals and play.' }
    ]
  },
  {
    key: 'vip',
    label: 'VIP club',
    category: 'engagement',
    flag: 'vipclub',
    variants: [
      { key: 'program_page', label: 'Program page with ladder', description: '/vip-program: marketing page signed out; signed in, overview, rewards grid and the tiered ladder, drawn from GET /user/vip and /user/vip/levels.' },
      { key: 'ring_panel', label: 'Header ring and detail page', description: '/vip-detail page (a dialog on phones), header ring and /user/enter panel, over its own 34-level ladder (data/vipConfig.js).' },
      { key: 'club_slider', label: 'Club page with ranking slider', description: '/vip-club page with banner, ranking slider, progress bar, benefits and FAQ; tier names from its own card map (api/vip.js).' },
      { key: 'club_ladder', label: 'Club page with a 75-level ladder', description: '/vip-club page with the level ring, bonus table and per-tier levels accordion, over its own 75-level ladder (VIP 01–VIP 75, brownz→diamond). Selecting it switches the BACKEND ladder: GET /user/vip, /user/vip/levels, USER_INFO, the bonus gates (VIP 20/25/30) and the player reports all rank on it (packages/common/src/vipLadders.js).' },
      { key: 'loyalty_club', label: 'Loyalty Club, 7 levels on points', description: '/loyalty page with the seven Loyalty Club levels (Beginner, Fan, Expert, Master, Guru, Legend, Hero) on loyalty points, 1 point = $1 wagered, with each level\'s points multiplier and milestone rewards. Selecting it switches the BACKEND ladder (packages/common/src/vipLadders.js). bitcasino + smartbet only.' },
      { key: 'none', label: 'Off', description: 'No VIP surface.' }
    ]
  },
  {
    key: 'promotions',
    label: 'Promotions',
    category: 'engagement',
    flag: null,
    variants: [
      { key: 'tile_grid', label: 'Tile grid with tabs', description: '/promotions tile grid with All/Casino/Sports tabs and pagination, plus a full article page per promotion. Hard-coded content.' },
      { key: 'event_list', label: 'Event list with archive', description: 'Event list with tabs and an archive popup, plus a separate /deposit-offer nth-deposit bonus page. Fixtures.' },
      { key: 'promo_cards', label: 'Promo card grid', description: 'Short promo card grid below the live wheel, bonus centre and gift cards on /promotions; on the home page for signed-out visitors.' },
      { key: 'none', label: 'Off', description: 'No promotions surface.' }
    ]
  },
  {
    key: 'spin_wheel',
    label: 'Spin wheel',
    category: 'engagement',
    flag: 'wheelspin',
    variants: [
      { key: 'inline_wheel', label: 'Inline wheel on promotions', description: 'Inline SVG wheel on /promotions drawn from GET /user/spin-wheel/slices; free first spin, then cooldown plus deposit; issues a deposit-bonus redeem code.' },
      { key: 'none', label: 'Off', description: 'No wheel.' }
    ]
  },
  {
    key: 'gift_cards',
    label: 'Gift cards',
    category: 'engagement',
    flag: 'giftcards',
    variants: [
      { key: 'claim_cards', label: 'Activate-then-claim cards', description: 'Activate-then-claim card list with deposit and wager progress and claimed history, on /promotions.' },
      { key: 'redeem_dialog', label: 'Sidebar card and redeem dialog', description: "Sidebar Gift Card card and redeem dialog. The player types the card's code; a card with no deposit or wager condition is claimed at once, one with conditions is activated." },
      { key: 'none', label: 'Off', description: 'No gift card surface.' }
    ]
  },
  {
    key: 'bonus',
    label: 'Bonus and rakeback',
    category: 'engagement',
    flag: 'bonus',
    variants: [
      { key: 'reward_cards', label: 'Reward cards inside the VIP page', description: 'Four reward cards (instant rakeback, daily, weekly, monthly) inside the signed-in VIP page, plus a redeem-code modal from the user menu.' },
      { key: 'reward_hub', label: 'Reward hub page', description: '/bonus hub in a reward-type layout with claim-all, a level card, a VIP panel and a Free Plays dialog (GIS free spins).' },
      { key: 'bonus_centre', label: 'Bonus centre block', description: 'Compact block on /promotions: redeem box, rakeback, recurring bonuses with socket countdowns, the player\'s codes and recent events.' },
      { key: 'none', label: 'Off', description: 'No bonus surface.' }
    ]
  },
  {
    key: 'affiliate',
    label: 'Affiliate / referral',
    category: 'engagement',
    flag: 'affiliate',
    variants: [
      { key: 'marketing_dashboard', label: 'Marketing page and dashboard', description: 'Public /affiliate marketing page plus a four-tab signed-in dashboard (overview, referred users, campaigns, earnings).' },
      { key: 'referral_hub', label: 'Referral hub', description: '/referral-exhibition marketing plus a multi-section /referral dashboard with referral codes, a rewards table and a rate calculator.' },
      { key: 'single_page', label: 'Single affiliate page', description: 'Single /affiliate page: overview and link, commission rules, and an available-commission claim-all block.' },
      { key: 'none', label: 'Off', description: 'No affiliate surface.' }
    ]
  },
  {
    key: 'races',
    label: 'Races and leaderboards',
    category: 'engagement',
    flag: null,
    variants: [
      { key: 'tournaments', label: 'Tournaments carousel and board tab', description: 'Home tournaments carousel, a \'Weekly Race\' tab on the activity board and a race info modal; reads the prize-less bet-history leaderboard.' },
      { key: 'daily_contest', label: 'Daily contest page', description: '/promotions/daily-contest page plus a contest tab on the home Latest Bets board; a wager contest with the visitor\'s rank.' },
      { key: 'race_boards', label: 'Daily and weekly race boards', description: 'Real user/race module: /races daily and weekly boards with operator prize pools, claimable rewards, and a home Races slider when signed in.' },
      { key: 'none', label: 'Off', description: 'No race or contest surface.' }
    ]
  },
  {
    key: 'challenges',
    label: 'Challenges / quests',
    category: 'engagement',
    flag: null,
    variants: [
      { key: 'multiplier_grid', label: 'Multiplier grid', description: 'Multiplier-challenge grid (\'first to hit Nx with min bet\') with Live/Finished tabs; cards do not open a game. No backend.' },
      { key: 'quest_hub', label: 'Quest hub with achievements', description: 'Signed-in quest hub (in progress, completed, expired) plus achievement medals on the profile. Fixtures, no backend.' },
      { key: 'live_multiplier', label: 'Multiplier grid over live games', description: 'Multiplier-challenge grid with sorting whose cards open real in-house games, beside the bets leaderboard. Terms hard-coded, no backend.' },
      { key: 'none', label: 'Off', description: 'No challenges surface.' }
    ]
  },
  {
    key: 'raffles',
    label: 'Raffles / lottery / airdrop',
    category: 'engagement',
    flag: 'lotto',
    variants: [
      { key: 'token_suite', label: 'Token suite: lottery, airdrop, token page', description: 'Token lottery page, airdrop page, token page and an airdrop tab on the activity board. Hard-coded, no backend.' },
      { key: 'ticket_raffle', label: 'Weekly ticket raffle', description: 'Weekly ticket raffle page (jackpot, prize ladder, winners, my tickets) plus a home rail of external lottery draws. Fixtures, no backend.' },
      { key: 'none', label: 'Off', description: 'No raffle or lottery surface.' }
    ]
  },
  {
    key: 'vault',
    label: 'Vault',
    category: 'wallet',
    flag: null,
    variants: [
      { key: 'flat_balance', label: 'Flat balance', description: 'One balance in and out; transfer-in uses the shortest active lock term, transfer-out closes unlocked deposits. Drawn as a header modal or as a /wallet/vault tab.' },
      { key: 'term_lock', label: 'Term locks with a period picker', description: 'Vault modal with a lock-period picker and per-deposit rows over GET /user/vault and /lock-options.' },
      { key: 'none', label: 'Off', description: 'No vault.' }
    ]
  },
  {
    key: 'swap',
    label: 'Swap',
    category: 'wallet',
    flag: null,
    variants: [
      { key: 'swap_page', label: 'Full swap page', description: 'Full-page /wallet/swap with 25/50/75/100% buttons, a USD min/max clamp and a completion popup; live estimate and trade.' },
      { key: 'wallet_tab', label: 'Swap tab in the wallet', description: 'Swap tab in the wallet modal with the server-quoted fee, and the last 8 swaps; live over HTTP.' },
      { key: 'none', label: 'Off', description: 'No swap.' }
    ]
  },
  {
    key: 'tips',
    label: 'Tips',
    category: 'wallet',
    flag: null,
    variants: [
      { key: 'peer_to_peer', label: 'Player-to-player tips', description: 'Players send part of their balance to another player by username (POST /user/tip/send), with a per-player opt-out, a sent/received history and a staff report.' },
      { key: 'none', label: 'Off', description: 'No tips.' }
    ]
  },

  // P2P trading is not offered for now (backend module unmounted as modules/_p2p), so it has no switch.
  {
    key: 'chat',
    label: 'Chat / social / presence',
    category: 'content',
    flag: null,
    variants: [
      { key: 'drawer', label: 'Chat drawer', description: 'Multi-language chat drawer with rich cards, rich list, emoji and GIF pickers, plus /chat-public on phones. Fixtures today.' },
      { key: 'right_rail', label: 'Right-rail chat with tip and rain', description: 'Two-room right-rail chat with tip and rain, friends and online counters, all live over the platform socket and GET /user/presence.' },
      { key: 'none', label: 'Off', description: 'No chat (the chat icon is hidden or disabled).' }
    ]
  },
  {
    key: 'notifications',
    label: 'Notifications',
    category: 'content',
    flag: null,
    variants: [
      { key: 'side_panel', label: 'Side panel with filters', description: 'Right-sidebar notification panel with filter chips. Not wired yet: the /user/notifications calls are declared but unused.' },
      { key: 'notice_centre', label: 'Notice centre with unread counts', description: 'Notice list over GET /user/notifications with unread counts, read and read-all, plus a comments tab.' },
      { key: 'header_bell', label: 'Header bell dropdown', description: 'Header bell dropdown (full-screen on phones). Not wired yet: always the empty state.' },
      { key: 'none', label: 'Off', description: 'No notification surface.' }
    ]
  },
  {
    key: 'banners',
    label: 'Hero banners',
    category: 'content',
    flag: 'home_heroSection',
    variants: [
      { key: 'image_carousel', label: 'Image carousel', description: 'Wide image-only carousel from placement \'home\' (one row); falls back to captured slides.' },
      { key: 'artwork_slides', label: 'Artwork slides', description: 'Captured slides whose artwork is replaced by placements home_top_1..N; title and link stay captured.' },
      { key: 'card_slides', label: 'Card slides with title and CTA', description: 'Card slides built from every \'hero-*\' placement with a title: operator title, subtitle and CTA.' },
      { key: 'none', label: 'Off', description: 'No hero.' }
    ]
  },
  {
    key: 'blog',
    label: 'Blog',
    category: 'content',
    flag: null,
    variants: [
      { key: 'tile_grid', label: 'Tile grid with article pages', description: 'Tile-grid blog with pagination and full article pages; the same layout as promotions. Captured posts today.' },
      { key: 'external_link', label: 'Link to an off-site blog', description: 'Sidebar link to an off-site blog; nothing hosted.' },
      { key: 'category_feed', label: 'Category-tabbed feed', description: 'Category-tabbed feed over GET /admin/blogs; post pages are captured only.' },
      { key: 'none', label: 'Off', description: 'No blog.' }
    ]
  },
  {
    key: 'casino_lobby',
    label: 'Casino lobby',
    category: 'casino',
    flag: 'casino',
    variants: [
      { key: 'aggregator', label: 'Aggregator-first lobby', description: 'Aggregator-first: rows from casino/games collections, category and provider browsing, favourites, recently played, js-games v2 launch.' },
      { key: 'tabbed_themes', label: 'Tabbed themes lobby', description: 'Tabbed lobby with themes, sections and tag pages; originals from js-games v1, the rest fixtures; favourites and recent live.' },
      { key: 'in_house', label: 'In-house-first lobby', description: 'In-house-first: js-games v1 curated collections, socket originals, \'Continue Playing\' from bet history; no favourites.' },
      { key: 'none', label: 'Off', description: 'Casino hidden.' }
    ]
  },
  {
    key: 'club_membership',
    label: 'Club membership',
    category: 'engagement',
    flag: 'clubmembership',
    variants: [
      { key: 'none', label: 'Off', description: 'No site implements clubs yet; the user/club and club-broadcasts backend is unused.' }
    ]
  },
  {
    key: 'kyc',
    label: 'KYC',
    category: 'wallet',
    flag: null,
    variants: [
      { key: 'status_card', label: 'Status card in settings', description: 'Status-only two-level card (L1 details, L2 ID) in settings; no upload.' },
      { key: 'document_cockpit', label: 'Document cockpit with uploads', description: 'Verification cockpit with document type, uploads (JPEG/PNG/PDF, 5 MB) and status panes mapped from all five platform statuses.' },
      { key: 'requirement_list', label: 'Requirement list with inline submit', description: 'Requirement-list settings tab with an inline submit form and the raw platform status.' },
      { key: 'none', label: 'Off', description: 'Verification hidden.' }
    ]
  },
  {
    key: 'push_notifications',
    label: 'Push notifications',
    category: 'integration',
    flag: null,
    variants: [
      { key: 'onesignal', label: 'OneSignal', description: 'Web push through OneSignal. Players are targeted by their platform id (external_id).' },
      { key: 'fcm', label: 'Firebase (FCM)', description: 'The legacy device-token path. Needs a Firebase service account on the backend.' },
      { key: 'none', label: 'Off', description: 'Notifications are recorded in the inbox but not pushed.' }
    ]
  },
  {
    key: 'analytics',
    label: 'Analytics (Google tag)',
    category: 'integration',
    flag: null,
    variants: [
      { key: 'gtm', label: 'Google Tag Manager', description: 'Loads the GTM container; GA4 and every other tag are configured inside it.' },
      { key: 'gtag', label: 'Google Analytics 4 (gtag.js)', description: 'Loads gtag.js directly with one GA4 measurement id — no container.' },
      { key: 'none', label: 'Off', description: 'No analytics tag is loaded.' }
    ]
  }
]

/** Each feature with a one-line summary of its variants (search and the row subtitle). */
export const FEATURE_CATALOGUE: (FeatureEntry & { description: string })[] = CATALOGUE.map(f => ({
  ...f,
  description: f.note ?? (f.variants
    .filter(v => f.policy || v.key !== 'none')
    .map(v => v.label)
    .join(' · ') || f.variants[0]?.description || '')
}))

export const FEATURE_CATEGORIES: { key: string; title: string }[] = [
  { key: 'business', title: 'Business' },
  { key: 'engagement', title: 'Engagement' },
  { key: 'wallet', title: 'Wallet' },
  { key: 'content', title: 'Content' },
  { key: 'casino', title: 'Casino' },
  { key: 'integration', title: 'Integrations' }
]

export const FLAG_GROUPS: FlagGroup[] = [
  {
    title: 'Products',
    description: 'Whole sections of the site. Off hides the section and its navigation.',
    keys: ['casino', 'sports', 'sportsexchange', 'sportsbook', 'lotto', 'vipclub', 'clubmembership', 'bonus', 'affiliate', 'giftcards', 'welcomepack', 'wheelspin', 'provablyfair']
  },
  {
    title: 'Game categories',
    description: 'Casino lobby tabs.',
    keys: ['crash', 'originals', 'livegames', 'slotsgames', 'alllivegames', 'allslotsgames', 'lotterygames', 'cards', 'instantgames']
  },
  {
    title: 'Providers',
    description: 'Third-party game providers offered in the lobby.',
    keys: ['spribe', 'evolution', 'pragmaticslots', 'pragmaticlive', 'ideal', 'microgaming', 'pgsoft', 'hacksawgaming', 'jili', 'jilli', 'netent']
  },
  {
    title: 'Fiat currencies',
    description: 'Wallet currencies a player may hold.',
    keys: ['inr', 'mvr', 'aed', 'pkr', 'bdt', 'npr', 'eur', 'idr']
  },
  {
    title: 'Crypto currencies',
    description: 'Master switch first, then each coin.',
    keys: ['cryptocoin', 'btc', 'eth', 'ltc', 'bch', 'usdt', 'trx', 'doge', 'ada', 'xrp', 'bnb', 'usdp', 'nexo', 'mkr', 'tusd', 'usdc', 'busd', 'shib', 'matic', 'nc', 'sc']
  },
  {
    title: 'Payment gateways',
    description: 'Off: the gateway takes no new deposits or withdrawals and leaves the site. Orders already open still settle.',
    keys: ['gateway_ccpayment', 'gateway_apay', 'gateway_waypay', 'gateway_cricpay', 'gateway_upi', 'gateway_f2pay']
  },
  {
    // Not "… currencies": a title matching /currenc/i is read as a coin group (lib/entitlements/siteCoins.ts).
    title: 'F2Pay',
    description: 'What F2Pay is active for: INR (UPI) and crypto (USDT). ON = a player depositing in it is offered F2Pay and pays in it. The site admin sees these and can only switch F2Pay as a whole.',
    keys: ['f2pay_inr', 'f2pay_usdt']
  },
  {
    title: 'Player sessions',
    description: 'ON: 5 minutes after a player signs in, the site checks once for a sports, Originals or casino bet in those 5 minutes; none signs the player out. The site admin can switch it off.',
    keys: ['idle_logout']
  },
  {
    title: 'Demo login',
    description: 'ON: a Demo Login button in the agent site\'s Sign In popup gives anyone a throwaway account — ₹1500, sports exchange bets only, no bonus or promotions, hidden from the admin — deleted after 30 minutes. OFF: no button, and new demos are refused.',
    keys: ['demo_login']
  },
  {
    title: 'Home page sections',
    description: 'Blocks on the landing page, top to bottom.',
    keys: [
      'home_heroSection',
      'home_welcomebanner',
      'home_latestwins',
      'home_livecasino',
      'home_livesports',
      'home_gamingcards',
      'home_popularslots',
      'home_bonus500banner',
      'home_crashgames',
      'home_paymentbanner',
      'home_leaderboard',
      'home_promocards'
    ]
  }
]

/* Flags that read OFF when the stored document has no value: switching one on changes what the
   site IS (the sportsbook replaces the exchange, idle logout signs players out), so it never happens
   by default or by "Allow all". Same set in backend/packages/common/src/entitlements.js. */
export const DEFAULT_OFF_FLAGS = new Set(['sportsbook', 'idle_logout'])

/* Sports runs one mode at a time: switching one of these on switches the other off. */
export const EXCLUSIVE_FLAGS: Record<string, string> = { sportsbook: 'sportsexchange', sportsexchange: 'sportsbook' }

export const FEATURE_KEYS = FEATURE_CATALOGUE.map(f => f.key)
export const FLAG_KEYS = [...new Set(FLAG_GROUPS.flatMap(g => g.keys))]

export const FLAG_LABELS: Record<string, string> = {
  casino: 'Casino',
  sports: 'Sports (kill switch: off refuses every new bet, open bets still settle)',
  sportsexchange: 'Sports exchange (our own exchange: markets, back/lay, agent system)',
  sportsbook: 'Sportsbook (third-party book in an iframe; on hides the whole exchange)',
  lotto: 'Lottery',
  vipclub: 'VIP club',
  clubmembership: 'Club membership',
  bonus: 'Bonus programme',
  affiliate: 'Affiliate / referral',
  giftcards: 'Gift cards',
  welcomepack: 'Welcome pack',
  wheelspin: 'Spin wheel',
  provablyfair: 'Provably fair',
  crash: 'Crash games',
  originals: 'Originals (in-house)',
  livegames: 'Live games',
  slotsgames: 'Slots',
  alllivegames: 'All live games tab',
  allslotsgames: 'All slots tab',
  lotterygames: 'Lottery games',
  cards: 'Card games',
  instantgames: 'Instant games',
  pragmaticslots: 'Pragmatic (slots)',
  pragmaticlive: 'Pragmatic (live)',
  hacksawgaming: 'Hacksaw Gaming',
  pgsoft: 'PG Soft',
  cryptocoin: 'Crypto wallets (master)',
  gateway_ccpayment: 'CCPayment (crypto deposits)',
  gateway_apay: 'A-Pay',
  gateway_waypay: 'WayPay',
  gateway_cricpay: 'CricPay',
  gateway_upi: 'UPI (EkQR)',
  gateway_f2pay: 'F2Pay (deposits)',
  f2pay_inr: 'INR (UPI)',
  f2pay_usdt: 'Crypto (USDT, TRC20)',
  idle_logout: 'Idle logout (no bet in the first 5 minutes after sign-in)',
  demo_login: 'Demo login (agent Sign In: ₹1500, sports only, 30 minutes)',
  idr: 'IDR',
  home_heroSection: 'Hero carousel',
  home_welcomebanner: 'Welcome banner',
  home_latestwins: 'Latest wins ticker',
  home_livecasino: 'Live casino row',
  home_livesports: 'Live sports row',
  home_gamingcards: 'Gaming cards',
  home_popularslots: 'Popular slots row',
  home_bonus500banner: 'Bonus banner',
  home_crashgames: 'Crash games row',
  home_paymentbanner: 'Payment methods banner',
  home_leaderboard: 'Leaderboard',
  home_promocards: 'Promo cards'
}

export const flagLabel = (key: string) => FLAG_LABELS[key] ?? key.replace(/^home_/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export const featureLabel = (key: string) => FEATURE_CATALOGUE.find(f => f.key === key)?.label ?? key

export const featureByKey = (key: string) => FEATURE_CATALOGUE.find(f => f.key === key) ?? null

export const isPolicy = (key: string) => featureByKey(key)?.policy === true

/** True when `variant` is one of `feature`'s variant keys. */
export const isVariantOf = (feature: string, variant: string) => !!featureByKey(feature)?.variants.some(v => v.key === variant)

/** "Activate-then-claim cards" for gift_cards/claim_cards; unknown keys pass through. */
export const variantLabel = (feature: string, variant: string | null | undefined) =>
  variant ? (featureByKey(feature)?.variants.find(v => v.key === variant)?.label ?? variant) : 'Not set'

/**
 * Owner-only ON/OFF options of a feature: how it behaves, not whether the site has it. Mirrors
 * `FEATURE_OPTIONS` in backend/packages/common/src/featureOptions.js (keys and defaults). Saved as
 * `options: { <feature>: { <option>: boolean } }`. A key the document lacks reads as its DEFAULT
 * (not as on), and the defaults are the site's long-standing behaviour. Add, never rename.
 */
export type OptionEntry = { key: string; label: string; description: string; default: boolean }

export const FEATURE_OPTIONS: Record<string, OptionEntry[]> = {
  spin_wheel: [
    {
      key: 'grant_on_registration',
      label: 'Free spin on registration',
      description: "A new player's first spin is free, no deposit needed.",
      default: true
    },
    {
      key: 'grant_on_first_deposit',
      label: 'Spin on first deposit',
      description: 'A player earns one spin after their first deposit at or above the minimum (no cooldown).',
      default: false
    },
    {
      key: 'grant_on_every_deposit',
      label: 'Spin on every deposit',
      description: 'After the cooldown, a deposit at or above the minimum made since the last spin earns the next spin.',
      default: true
    },
    {
      key: 'bonus_on_first_deposit',
      label: 'Bonus applies to first deposit',
      description: "A won code may be applied to the player's first deposit. Off: it waits for a later deposit.",
      default: true
    },
    {
      key: 'bonus_on_later_deposits',
      label: 'Bonus applies to later deposits',
      description: 'A won code may be applied to a deposit after the first.',
      default: true
    }
  ],
  bonus: [
    {
      key: 'wagering_lock',
      label: 'Bonus wagering lock',
      description:
        'First-deposit and spin bonuses go to a locked bonus balance and become cash only after their wagering requirement is met. Off: they are paid straight to cash.',
      default: true
    }
  ],
  races: [
    {
      key: 'tournaments_page',
      label: 'Tournaments page',
      description:
        'The player site shows the Tournaments page (live, upcoming and finished races with their leaderboards) and its menu entry. Off: hidden; the races still run and pay.',
      default: true
    }
  ]
}

export const optionsOf = (feature: string) => FEATURE_OPTIONS[feature] ?? []

export const optionLabel = (key: string) => {
  const [feature, option] = key.split('.')

  return `${featureLabel(feature)}: ${optionsOf(feature).find(o => o.key === option)?.label ?? option}`
}

/** Every option of every feature: the document's value, else the default. Unknown keys dropped. */
export function resolveOptions(map: unknown): Record<string, Record<string, boolean>> {
  const given = map && typeof map === 'object' && !Array.isArray(map) ? (map as Record<string, unknown>) : {}
  const out: Record<string, Record<string, boolean>> = {}

  for (const [feature, entries] of Object.entries(FEATURE_OPTIONS)) {
    const values = given[feature] && typeof given[feature] === 'object' ? (given[feature] as Record<string, unknown>) : {}

    out[feature] = Object.fromEntries(entries.map(o => [o.key, typeof values[o.key] === 'boolean' ? (values[o.key] as boolean) : o.default]))
  }

  return out
}
