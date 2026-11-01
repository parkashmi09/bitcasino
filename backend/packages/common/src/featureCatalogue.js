'use strict';

const { REWARD_CURRENCY, REWARD_CURRENCY_CHOICES, REWARD_CURRENCY_NAMES, DEFAULT_CURRENCY, DEFAULT_CURRENCY_CHOICES } = require('./currencies');

/**
 * The feature catalogue — every feature a site can offer, the named ways it
 * can be offered, and the site templates that pick one of each.
 *
 * GENERATED FROM the "Variant catalogue" block of docs/FEATURE-COMPARISON.md,
 * where every variant is traced to the file that implements it. Change the
 * doc and regenerate; the integrations (push, analytics) and the business
 * policies below are hand-written.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY VARIANTS AND NOT MORE FLAGS
 *
 * Three sites run this platform and each implements the same feature its own
 * way: the VIP club is a 41-level ladder on one, bc.game's 34-level ladder on
 * another. A boolean cannot say which. A variant can, and it is ONE value per
 * feature per site rather than one column per site per feature — adding a
 * fourth site adds rows, not a migration.
 *
 * Each site has its own database, so the SELECTION lives in that site's
 * `site_features` table. This file is the MENU: the same everywhere, so a
 * variant key means the same thing wherever it is stored.
 *
 * A variant is listed only where a site actually implements it. A dropdown
 * option that switches a feature "on" with nothing behind it would be a
 * promise the page cannot keep. Where two sites implement a feature the same
 * way they share one key (`flat` for the vault); `external` is a link out.
 *
 * ── THE KEYS ARE A CONTRACT ─────────────────────────────────────────────
 *
 * A front end reads `variant` from `GET /admin/features/public` and decides
 * what to draw. Renaming a key silently turns that feature off on every site
 * that stored the old one. Add keys; do not rename them.
 *
 * `flag` names the `siteconfig` column that gates the same feature, where one
 * exists; the features service keeps it in step.
 * ═════════════════════════════════════════════════════════════════════════
 */

const GENERATED = [
    {
      "key": "vip",
      "label": "VIP club",
      "category": "engagement",
      "flag": "vipclub",
      "variants": [
        {
          "key": "program_page",
          "label": "Program page with ladder",
          "description": "/vip-program: marketing page signed out; signed in, overview, rewards grid and the tiered ladder, drawn from GET /user/vip and /user/vip/levels.",
          "builtFor": "shuffle"
        },
        {
          "key": "ring_panel",
          "label": "Header ring and detail page",
          "description": "/vip-detail page (a dialog on phones), header ring and /user/enter panel, over its own 34-level ladder (data/vipConfig.js).",
          "builtFor": "hash-games"
        },
        {
          "key": "club_slider",
          "label": "Club page with ranking slider",
          "description": "/vip-club page with banner, ranking slider, progress bar, benefits and FAQ; tier names from its own card map (api/vip.js).",
          "builtFor": "stake-site"
        },
        {
          "key": "club_ladder",
          "label": "Club page with a 75-level ladder",
          "description": "/vip-club page with the level ring, bonus table and per-tier levels accordion, over its own 75-level ladder (VIP 01\u2013VIP 75, brownz\u2192diamond). Selecting it switches the BACKEND ladder: GET /user/vip, /user/vip/levels, USER_INFO, the bonus gates (VIP 20/25/30) and the player reports all rank on it (packages/common/src/vipLadders.js).",
          "builtFor": "addaplay"
        },
        {
          "key": "loyalty_club",
          "label": "Loyalty Club, 7 levels on points",
          "description": "/loyalty page with the seven Loyalty Club levels (Beginner, Fan, Expert, Master, Guru, Legend, Hero) on loyalty points, 1 point = $1 wagered, with each level's points multiplier and milestone rewards. Selecting it switches the BACKEND ladder (packages/common/src/vipLadders.js). bitcasino + smartbet only.",
          "builtFor": "bitcasino"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No VIP surface."
        }
      ]
    },
    {
      "key": "promotions",
      "label": "Promotions",
      "category": "engagement",
      "flag": null,
      "variants": [
        {
          "key": "tile_grid",
          "label": "Tile grid with tabs",
          "description": "/promotions tile grid with All/Casino/Sports tabs and pagination, plus a full article page per promotion. Hard-coded content.",
          "builtFor": "shuffle"
        },
        {
          "key": "event_list",
          "label": "Event list with archive",
          "description": "Event list with tabs and an archive popup, plus a separate /deposit-offer nth-deposit bonus page. Fixtures.",
          "builtFor": "hash-games"
        },
        {
          "key": "promo_cards",
          "label": "Promo card grid",
          "description": "Short promo card grid below the live wheel, bonus centre and gift cards on /promotions; on the home page for signed-out visitors.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No promotions surface."
        }
      ]
    },
    {
      "key": "spin_wheel",
      "label": "Spin wheel",
      "category": "engagement",
      "flag": "wheelspin",
      "variants": [
        {
          "key": "inline_wheel",
          "label": "Inline wheel on promotions",
          "description": "Inline SVG wheel on /promotions drawn from GET /user/spin-wheel/slices; free first spin, then cooldown plus deposit; issues a deposit-bonus redeem code.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No wheel."
        }
      ]
    },
    {
      "key": "gift_cards",
      "label": "Gift cards",
      "category": "engagement",
      "flag": "giftcards",
      "variants": [
        {
          "key": "claim_cards",
          "label": "Activate-then-claim cards",
          "description": "Activate-then-claim card list with deposit and wager progress and claimed history, on /promotions.",
          "builtFor": "stake-site"
        },
        {
          "key": "redeem_dialog",
          "label": "Sidebar card and redeem dialog",
          "description": "Sidebar Gift Card card and redeem dialog. The player types the card's code; a card with no deposit or wager condition is claimed at once, one with conditions is activated.",
          "builtFor": "hash-games"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No gift card surface."
        }
      ]
    },
    {
      "key": "bonus",
      "label": "Bonus and rakeback",
      "category": "engagement",
      "flag": "bonus",
      "variants": [
        {
          "key": "reward_cards",
          "label": "Reward cards inside the VIP page",
          "description": "Four reward cards (instant rakeback, daily, weekly, monthly) inside the signed-in VIP page, plus a redeem-code modal from the user menu.",
          "builtFor": "shuffle"
        },
        {
          "key": "reward_hub",
          "label": "Reward hub page",
          "description": "/bonus hub in a reward-type layout with claim-all, a level card, a VIP panel and a Free Plays dialog (GIS free spins).",
          "builtFor": "hash-games"
        },
        {
          "key": "bonus_centre",
          "label": "Bonus centre block",
          "description": "Compact block on /promotions: redeem box, rakeback, recurring bonuses with socket countdowns, the player's codes and recent events.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No bonus surface."
        }
      ]
    },
    {
      "key": "affiliate",
      "label": "Affiliate / referral",
      "category": "engagement",
      "flag": "affiliate",
      "variants": [
        {
          "key": "marketing_dashboard",
          "label": "Marketing page and dashboard",
          "description": "Public /affiliate marketing page plus a four-tab signed-in dashboard (overview, referred users, campaigns, earnings).",
          "builtFor": "shuffle"
        },
        {
          "key": "referral_hub",
          "label": "Referral hub",
          "description": "/referral-exhibition marketing plus a multi-section /referral dashboard with referral codes, a rewards table and a rate calculator.",
          "builtFor": "hash-games"
        },
        {
          "key": "single_page",
          "label": "Single affiliate page",
          "description": "Single /affiliate page: overview and link, commission rules, and an available-commission claim-all block.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No affiliate surface."
        }
      ]
    },
    {
      "key": "races",
      "label": "Races and leaderboards",
      "category": "engagement",
      "flag": null,
      "variants": [
        {
          "key": "tournaments",
          "label": "Tournaments carousel and board tab",
          "description": "Home tournaments carousel, a 'Weekly Race' tab on the activity board and a race info modal; reads the prize-less bet-history leaderboard.",
          "builtFor": "shuffle"
        },
        {
          "key": "daily_contest",
          "label": "Daily contest page",
          "description": "/promotions/daily-contest page plus a contest tab on the home Latest Bets board; a wager contest with the visitor's rank.",
          "builtFor": "hash-games"
        },
        {
          "key": "race_boards",
          "label": "Daily and weekly race boards",
          "description": "Real user/race module: /races daily and weekly boards with operator prize pools, claimable rewards, and a home Races slider when signed in.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No race or contest surface."
        }
      ]
    },
    {
      "key": "challenges",
      "label": "Challenges / quests",
      "category": "engagement",
      "flag": null,
      "variants": [
        {
          "key": "multiplier_grid",
          "label": "Multiplier grid",
          "description": "Multiplier-challenge grid ('first to hit Nx with min bet') with Live/Finished tabs; cards do not open a game. No backend.",
          "builtFor": "shuffle"
        },
        {
          "key": "quest_hub",
          "label": "Quest hub with achievements",
          "description": "Signed-in quest hub (in progress, completed, expired) plus achievement medals on the profile. Fixtures, no backend.",
          "builtFor": "hash-games"
        },
        {
          "key": "live_multiplier",
          "label": "Multiplier grid over live games",
          "description": "Multiplier-challenge grid with sorting whose cards open real in-house games, beside the bets leaderboard. Terms hard-coded, no backend.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No challenges surface."
        }
      ]
    },
    {
      "key": "raffles",
      "label": "Raffles / lottery / airdrop",
      "category": "engagement",
      "flag": "lotto",
      "variants": [
        {
          "key": "token_suite",
          "label": "Token suite: lottery, airdrop, token page",
          "description": "Token lottery page, airdrop page, token page and an airdrop tab on the activity board. Hard-coded, no backend.",
          "builtFor": "shuffle"
        },
        {
          "key": "ticket_raffle",
          "label": "Weekly ticket raffle",
          "description": "Weekly ticket raffle page (jackpot, prize ladder, winners, my tickets) plus a home rail of external lottery draws. Fixtures, no backend.",
          "builtFor": "hash-games"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No raffle or lottery surface."
        }
      ]
    },
    {
      "key": "vault",
      "label": "Vault",
      "category": "wallet",
      "flag": null,
      "variants": [
        {
          "key": "flat_balance",
          "label": "Flat balance",
          "description": "One balance in and out; transfer-in uses the shortest active lock term, transfer-out closes unlocked deposits. Drawn as a header modal or as a /wallet/vault tab."
        },
        {
          "key": "term_lock",
          "label": "Term locks with a period picker",
          "description": "Vault modal with a lock-period picker and per-deposit rows over GET /user/vault and /lock-options.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No vault."
        }
      ]
    },
    {
      "key": "swap",
      "label": "Swap",
      "category": "wallet",
      "flag": null,
      "variants": [
        {
          "key": "swap_page",
          "label": "Full swap page",
          "description": "Full-page /wallet/swap with 25/50/75/100% buttons, a USD min/max clamp and a completion popup; live estimate and trade.",
          "builtFor": "hash-games"
        },
        {
          "key": "wallet_tab",
          "label": "Swap tab in the wallet",
          "description": "Swap tab in the wallet modal with the server-quoted fee, and the last 8 swaps; live over HTTP.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No swap."
        }
      ]
    },
    {
      "key": "chat",
      "label": "Chat / social / presence",
      "category": "content",
      "flag": null,
      "variants": [
        {
          "key": "drawer",
          "label": "Chat drawer",
          "description": "Multi-language chat drawer with rich cards, rich list, emoji and GIF pickers, plus /chat-public on phones. Fixtures today.",
          "builtFor": "hash-games"
        },
        {
          "key": "right_rail",
          "label": "Right-rail chat with tip and rain",
          "description": "Two-room right-rail chat with tip and rain, friends and online counters, all live over the platform socket and GET /user/presence.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No chat (the chat icon is hidden or disabled)."
        }
      ]
    },
    {
      "key": "notifications",
      "label": "Notifications",
      "category": "content",
      "flag": null,
      "variants": [
        {
          "key": "side_panel",
          "label": "Side panel with filters",
          "description": "Right-sidebar notification panel with filter chips. Not wired yet: the /user/notifications calls are declared but unused.",
          "builtFor": "shuffle"
        },
        {
          "key": "notice_centre",
          "label": "Notice centre with unread counts",
          "description": "Notice list over GET /user/notifications with unread counts, read and read-all, plus a comments tab.",
          "builtFor": "hash-games"
        },
        {
          "key": "header_bell",
          "label": "Header bell dropdown",
          "description": "Header bell dropdown (full-screen on phones). Not wired yet: always the empty state.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No notification surface."
        }
      ]
    },
    {
      "key": "banners",
      "label": "Hero banners",
      "category": "content",
      "flag": "home_heroSection",
      "variants": [
        {
          "key": "image_carousel",
          "label": "Image carousel",
          "description": "Wide image-only carousel from placement 'home' (one row); falls back to captured slides.",
          "builtFor": "shuffle"
        },
        {
          "key": "artwork_slides",
          "label": "Artwork slides",
          "description": "Captured slides whose artwork is replaced by placements home_top_1..N; title and link stay captured.",
          "builtFor": "hash-games"
        },
        {
          "key": "card_slides",
          "label": "Card slides with title and CTA",
          "description": "Card slides built from every 'hero-*' placement with a title: operator title, subtitle and CTA.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No hero."
        }
      ]
    },
    {
      "key": "blog",
      "label": "Blog",
      "category": "content",
      "flag": null,
      "variants": [
        {
          "key": "tile_grid",
          "label": "Tile grid with article pages",
          "description": "Tile-grid blog with pagination and full article pages; the same layout as promotions. Captured posts today.",
          "builtFor": "shuffle"
        },
        {
          "key": "external_link",
          "label": "Link to an off-site blog",
          "description": "Sidebar link to an off-site blog; nothing hosted."
        },
        {
          "key": "category_feed",
          "label": "Category-tabbed feed",
          "description": "Category-tabbed feed over GET /admin/blogs; post pages are captured only.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "No blog."
        }
      ]
    },
    {
      "key": "casino_lobby",
      "label": "Casino lobby",
      "category": "casino",
      "flag": "casino",
      "variants": [
        {
          "key": "aggregator",
          "label": "Aggregator-first lobby",
          "description": "Aggregator-first: rows from casino/games collections, category and provider browsing, favourites, recently played, js-games v2 launch.",
          "builtFor": "shuffle"
        },
        {
          "key": "tabbed_themes",
          "label": "Tabbed themes lobby",
          "description": "Tabbed lobby with themes, sections and tag pages; originals from js-games v1, the rest fixtures; favourites and recent live.",
          "builtFor": "hash-games"
        },
        {
          "key": "in_house",
          "label": "In-house-first lobby",
          "description": "In-house-first: js-games v1 curated collections, socket originals, 'Continue Playing' from bet history; no favourites.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "Casino hidden."
        }
      ]
    },
    {
      "key": "club_membership",
      "label": "Club membership",
      "category": "engagement",
      "flag": "clubmembership",
      "variants": [
        {
          "key": "none",
          "label": "Off",
          "description": "No site implements clubs yet; the user/club and club-broadcasts backend is unused."
        }
      ]
    },
    {
      "key": "kyc",
      "label": "KYC",
      "category": "wallet",
      "flag": null,
      "variants": [
        {
          "key": "status_card",
          "label": "Status card in settings",
          "description": "Status-only two-level card (L1 details, L2 ID) in settings; no upload.",
          "builtFor": "shuffle"
        },
        {
          "key": "document_cockpit",
          "label": "Document cockpit with uploads",
          "description": "Verification cockpit with document type, uploads (JPEG/PNG/PDF, 5 MB) and status panes mapped from all five platform statuses.",
          "builtFor": "hash-games"
        },
        {
          "key": "requirement_list",
          "label": "Requirement list with inline submit",
          "description": "Requirement-list settings tab with an inline submit form and the raw platform status.",
          "builtFor": "stake-site"
        },
        {
          "key": "none",
          "label": "Off",
          "description": "Verification hidden."
        }
      ]
    }
  ];

/**
 * Peer-to-peer tips — hand-written, like the integrations below (not in the
 * generated block, so a regeneration from the doc keeps it). The player API is
 * `services/user/src/modules/tip`, guarded by `requireFeature('tips')`.
 */
const TIPS = {
  key: 'tips',
  label: 'Tips',
  category: 'wallet',
  flag: null,
  variants: [
    {
      key: 'peer_to_peer',
      label: 'Player-to-player tips',
      description: 'Players send part of their balance to another player by username (POST /user/tip/send), with a per-player opt-out, a sent/received history and a staff report.',
    },
    { key: 'none', label: 'Off', description: 'No tips.' },
  ],
};

/**
 * Peer-to-peer trading — hand-written, like TIPS. The player API is
 * `services/user/src/modules/_p2p` (`/user/p2p`, unmounted for now: `_` folders are skipped), the operator's is `/admin/p2p`;
 * both routers are guarded by `requireFeature('p2p')`, so an owner who leaves
 * it out of the plan closes the player trades and the staff screens alike.
 */
const P2P = {
  key: 'p2p',
  label: 'P2P trading',
  category: 'wallet',
  flag: null,
  variants: [
    {
      key: 'order_book',
      label: 'P2P trading',
      description: 'Players buy and sell crypto against staff-run fiat offers (GET /user/p2p/offers, POST /user/p2p/orders, /sell-orders), with payment proofs, disputes and a staff release desk.',
    },
    { key: 'none', label: 'Off', description: 'No P2P trading.' },
  ],
};

const PUSH_NOTIFICATIONS = {
  key: 'push_notifications',
  label: 'Push notifications',
  category: 'integration',
  flag: null,
  variants: [
    {
      key: 'onesignal',
      label: 'OneSignal',
      description: 'Web push through OneSignal. Players are targeted by their platform id (external_id).',
      /** Shown to the browser. The App ID is public by design — the web SDK needs it. */
      publicFields: ['appId'],
      configFields: [
        { key: 'appId', label: 'OneSignal App ID', required: true, pattern: '^[0-9a-fA-F-]{36}$' },
        { key: 'segment', label: 'Test segment', required: false, placeholder: 'Subscribed Users' },
      ],
      /** Sealed at rest in `secrets`; never returned by any route. */
      secretFields: [{ key: 'apiKey', label: 'App API key (os_v2_…)', required: true }],
    },
    { key: 'fcm', label: 'Firebase (FCM)', description: 'The legacy device-token path. Needs a Firebase service account on the backend.' },
    { key: 'none', label: 'Off', description: 'Notifications are recorded in the inbox but not pushed.' },
  ],
};

/**
 * Site analytics — which Google tag the player pages load, and its id.
 *
 * Hand-written, like the push integration. Both ids are PUBLIC by design (the
 * browser loads the tag with them), so they are `publicFields` and reach the
 * page through `GET /admin/features/public` and the socket's `getSiteConfig`.
 * The front end injects the tag itself; nothing is hard-coded in its HTML.
 */
const ANALYTICS = {
  key: 'analytics',
  label: 'Analytics (Google tag)',
  category: 'integration',
  flag: null,
  variants: [
    {
      key: 'gtm',
      label: 'Google Tag Manager',
      description: 'Loads the GTM container; GA4 and every other tag are configured inside it.',
      publicFields: ['containerId'],
      configFields: [{ key: 'containerId', label: 'GTM container ID', required: true, pattern: '^GTM-[A-Z0-9]{4,12}$', placeholder: 'GTM-XXXXXXX' }],
    },
    {
      key: 'gtag',
      label: 'Google Analytics 4 (gtag.js)',
      description: 'Loads gtag.js directly with one GA4 measurement id — no container.',
      publicFields: ['measurementId'],
      configFields: [{ key: 'measurementId', label: 'GA4 measurement ID', required: true, pattern: '^G-[A-Z0-9]{4,12}$', placeholder: 'G-XXXXXXXXXX' }],
    },
    { key: 'none', label: 'Off', description: 'No analytics tag is loaded.' },
  ],
};

/**
 * Business policies — hand-written, like the integration above.
 *
 * `kind: 'policy'` means always in force: there is no on/off switch, only the
 * variant, and a site that never chose one reads `defaultVariant` — which is
 * today's behaviour, so adding these closed nobody's cashier. `none` closes
 * the channel. Templates never set these; a template silently reopening a
 * cashier an operator had closed is the wrong direction to fail in.
 * Enforced in the services by packages/common/src/sitePolicy.js.
 */
const POLICIES = [
  {
    key: 'business_model',
    label: 'Business model',
    category: 'business',
    kind: 'policy',
    flag: null,
    defaultVariant: 'hybrid',
    variants: [
      { key: 'b2c', label: 'B2C — direct players', description: 'Anyone may sign up and use the cashier themselves.' },
      { key: 'b2b', label: 'B2B — agent network', description: 'Public sign-up is closed. Players are created by agents in the staff tree and funded by transfer.' },
      { key: 'hybrid', label: 'Hybrid', description: 'Public sign-up is open, and agents may also create and fund players. The default.' },
    ],
  },
  {
    key: 'deposit_mode',
    label: 'Deposits',
    category: 'business',
    kind: 'policy',
    flag: null,
    defaultVariant: 'both',
    variants: [
      { key: 'automatic', label: 'Automatic only', description: 'Gateway and crypto deposits, credited by the provider callback. Manual transfer submissions are refused.' },
      { key: 'manual', label: 'Manual only', description: 'The player submits a transfer reference and screenshot; staff approve it. Gateway and crypto deposits are refused.' },
      { key: 'both', label: 'Automatic and manual', description: 'Both routes are open. The default.' },
      { key: 'none', label: 'Closed', description: 'No new deposits. Pending ones can still be approved, and provider callbacks still credit.' },
    ],
  },
  {
    key: 'withdrawal_mode',
    label: 'Withdrawals',
    category: 'business',
    kind: 'policy',
    flag: null,
    defaultVariant: 'both',
    variants: [
      { key: 'automatic', label: 'Automatic only', description: 'Paid out by the gateway (needs AUTO_WITHDRAWALS_ENABLED on the backend). Manual requests are refused.' },
      { key: 'manual', label: 'Manual only', description: 'The player requests; the cashier team reviews and pays by hand. Gateway payouts are refused.' },
      { key: 'both', label: 'Automatic and manual', description: 'Both routes are open. The default.' },
      { key: 'none', label: 'Closed', description: 'No new withdrawal requests. Pending ones can still be decided.' },
    ],
  },
];

/**
 * The reward currency — one coin every reward is calculated and paid in.
 *
 * A policy like the three above (always in force, the variant IS the setting,
 * the owner alone sets it, staff see it read-only → `403 OWNER_MANAGED`), but
 * with no `none`: rewards always pay in something. Variant keys are the coin
 * codes themselves (`REWARD_CURRENCY_CHOICES` in currencies.js), so the
 * stored `site_features.variant` is the code. Read by admin-service
 * `SiteConfigService.rewardCurrencies()` and from there by every reward path
 * (`.claude/skills/reward-currency`).
 */
const REWARD_CURRENCY_POLICY = {
  key: 'reward_currency',
  label: 'Reward currency',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: REWARD_CURRENCY,
  variants: REWARD_CURRENCY_CHOICES.map((code) => ({
    key: code,
    label: `${code} — ${REWARD_CURRENCY_NAMES[code] ?? code}`,
    description: `All rewards — VIP, bonuses, rakeback, affiliate, spin wheel — are calculated and paid in ${code}.`,
  })),
};

/**
 * The default coin — the currency every money screen opens on (site admin
 * Finance filters, the player's deposit dialog and, for a player with no
 * funded coin, the header balance chip). A policy like the reward currency
 * (always in force, no `none`, owner-only → `403 OWNER_MANAGED`); variant
 * keys are the coin codes (`DEFAULT_CURRENCY_CHOICES` in currencies.js).
 * Read by admin-service `SiteConfigService.defaultCurrency()` and published
 * as `defaultCurrency` on `GET /admin/site-config/public`.
 */
const DEFAULT_CURRENCY_POLICY = {
  key: 'default_currency',
  label: 'Default coin',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: DEFAULT_CURRENCY,
  variants: DEFAULT_CURRENCY_CHOICES.map((code) => ({
    key: code,
    label: `${code} — ${REWARD_CURRENCY_NAMES[code] ?? code}`,
    description: `Admin Finance screens open filtered to ${code}, and players see ${code} first in the deposit dialog.`,
  })),
};

/**
 * Region restriction — which countries the site serves (packages/common/src/regionPolicy.js).
 *
 * A policy (always in force, the variant IS the mode, the owner alone sets it, staff see it
 * read-only → `403 OWNER_MANAGED`). `none` is Off, the default: nobody is restricted. The
 * list type and the countries travel beside it in the owner's document (`region`).
 */
const REGION_RESTRICTION_POLICY = {
  key: 'region_restriction',
  label: 'Region restriction',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'none',
  variants: [
    { key: 'none', label: 'Off', description: 'Players from every country may visit, sign up and log in. The default.' },
    { key: 'notice', label: 'Notice only', description: 'Visitors from a restricted country see the region notice, which they can dismiss. Sign-up and login stay open.' },
    { key: 'block', label: 'Block', description: 'Visitors from a restricted country see the region notice, and the backend refuses their sign-up and login (403 REGION_RESTRICTED). Staff login is not affected.' },
  ],
};

/**
 * Withdrawal requirements — what a player must have done before a withdrawal is accepted
 * (services/user/src/modules/withdraw-requirements).
 *
 * A policy (always in force, the variant IS the rule, the owner alone sets it, staff see it
 * read-only → `403 OWNER_MANAGED`). Here `none` is NOT "closed": it means nothing is required.
 * The default `kyc` is the behaviour before this policy existed (KYC Verified on every rail).
 * "Wagering complete" = no active bonus with unmet wagering AND the deposit rollover
 * (`/user/wager/tasks`) complete. Enforced on fiat, crypto (HTTP + socket) and gateway payouts.
 * Since 2026-10-21 the deposit rollover is required under every variant (withdrawRequirements.js).
 */
const WITHDRAWAL_REQUIREMENTS_POLICY = {
  key: 'withdrawal_requirements',
  label: 'Withdrawal requirements',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'kyc',
  variants: [
    { key: 'none', label: 'No KYC', description: 'KYC is not required to withdraw. The deposit rollover still has to be complete, and an active bonus forfeited (the player confirms).' },
    { key: 'kyc', label: 'KYC verified', description: 'The player\'s KYC must be Verified, and the deposit rollover complete. The default.' },
    { key: 'wager', label: 'Wagering complete', description: 'Every open wagering requirement (deposit rollover and active bonuses) must be complete. KYC is not checked. Forfeiting a bonus clears its part.' },
    { key: 'kyc_and_wager', label: 'KYC and wagering', description: 'KYC must be Verified and every open wagering requirement complete.' },
  ],
};

/**
 * The casino aggregator — whose game catalogue the lobby serves (services/casino/src/modules/games/catalogueSwitch.js).
 *
 * A policy (always in force, the variant IS the setting, the owner alone sets it, staff see it
 * read-only → `403 OWNER_MANAGED`), with no `none`: the lobby always has one aggregator. The
 * catalogue table holds ONE aggregator's games at a time; switching parks the other's rows in
 * `gisgamesnew_parked` (migration 097) and brings the chosen one's back, so switching back needs
 * no re-fetch. The default `js_games` is the catalogue every site had before this existed.
 */
const CASINO_AGGREGATOR_POLICY = {
  key: 'casino_aggregator',
  label: 'Casino games provider',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'js_games',
  variants: [
    { key: 'js_games', label: 'JSGames', description: 'The lobby serves the JSGames catalogue and games launch through JSGames. The default.' },
    { key: 'slotegrator', label: 'Slotegrator', description: 'The lobby serves the Slotegrator catalogue and games launch through Slotegrator. Run the Slotegrator sync to fill it.' },
  ],
};

/**
 * Light / dark theme — a policy like the casino aggregator: always in force, the owner alone sets
 * it. `dark_only` (the default) keeps the player site dark with no theme toggle; `switch` brings
 * the light theme and the toggles back (frontend services/gates.js `themeSwitch`).
 */
const THEME_MODE_POLICY = {
  key: 'theme_mode',
  label: 'Light / dark theme',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'dark_only',
  variants: [
    { key: 'dark_only', label: 'Dark only', description: 'The site is always dark; no theme toggle anywhere. The default.' },
    { key: 'switch', label: 'Dark and light', description: 'Players can switch between the dark and the light theme (sidebar, account page, Settings → Preferences).' },
  ],
};

/**
 * Admin colour theme — bitcasino + smartbet: the owner picks the site admin's palette apart from the
 * player site's template. `same` (the default) follows the template; `original` keeps the admin's
 * own colours; a palette key colours the admin only (admin components/layout/PaletteSync.tsx).
 */
const ADMIN_THEME_POLICY = {
  key: 'admin_theme',
  label: 'Admin colour theme',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'same',
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
    { key: 'ocean_ruby', label: 'Ocean Ruby', description: 'The admin uses the Ocean Ruby palette.' },
  ],
};

/**
 * Slotegrator INR games launched in PKR — a policy (owner-only). `on`: an INR-wallet game opens
 * at Slotegrator in PKR; each callback's PKR is converted to INR at the site's rates and the INR
 * wallet is checked, debited and credited. `off` (the default): INR launches and settles as INR.
 * Read by casino-service gis.service.js, per launch (the session remembers it).
 */
const SLOTEGRATOR_INR_AS_PKR_POLICY = {
  key: 'slotegrator_inr_as_pkr',
  label: 'Slotegrator: INR games in PKR',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'off',
  variants: [
    { key: 'off', label: 'Off', description: 'An INR bet launches the game in INR and settles in INR. The default.' },
    { key: 'on', label: 'On', description: 'An INR bet launches the Slotegrator game in PKR; every bet, win and refund is converted PKR → INR at the site rate and moves the INR wallet.' },
  ],
};

/**
 * API encryption — a policy (owner-only). `on`: the gateway answers the player site's API calls
 * AES-256-GCM encrypted and the site decrypts them; `off` (the default): plain JSON.
 */
const API_ENCRYPTION_POLICY = {
  key: 'api_encryption',
  label: 'API encryption',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'off',
  variants: [
    { key: 'off', label: 'Off', description: 'The player site\'s API data comes as plain JSON. The default.' },
    { key: 'on', label: 'On', description: 'The player site\'s API data comes encrypted (AES-256-GCM) and the site decrypts it.' },
  ],
};

/**
 * Rate limit — a policy (owner-only). `on` (the default): every service's rate limits count;
 * `off`: they stop, except the login / password reset / OTP / 2FA guards, which never switch off
 * (packages/common/src/middleware/rateLimit.js).
 */
const RATE_LIMIT_POLICY = {
  key: 'rate_limit',
  label: 'Rate limit',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'on',
  variants: [
    { key: 'on', label: 'On', description: 'Too many requests from one player or address are refused for a while. The default.' },
    { key: 'off', label: 'Off', description: 'No request limits, except the login, password reset, OTP and 2FA guards.' },
  ],
};

/**
 * Branch management — a policy (owner-only). `on`: the Super Admin creates branches (own login at
 * the admin's /branch), each branch creates and watches its own direct players; `off` (the
 * default): the admin screens hide, the branch APIs answer 403 and no branch can sign in
 * (admin-service modules/branches).
 */
const BRANCH_MANAGEMENT_POLICY = {
  key: 'branch_management',
  label: 'Branch management',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'off',
  variants: [
    { key: 'off', label: 'Off', description: 'No branches: the admin screens hide and no branch can sign in. The default.' },
    { key: 'on', label: 'On', description: 'The Super Admin creates branches; each branch signs in at /branch, creates its own players and sees their deposits, withdrawals and play.' },
  ],
};

/**
 * Whitelabel — a policy (owner-only). `on` (the default, the behaviour before the switch): the
 * Super Admin gets the Whitelabel panel; `off`: the admin menu hides and the whitelabel APIs
 * answer 403 (admin-service modules/whitelabels). Live copies keep running either way.
 */
const WHITELABEL_POLICY = {
  key: 'whitelabel',
  label: 'Whitelabel',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'on',
  variants: [
    { key: 'on', label: 'On', description: 'The Super Admin creates and manages whitelabel copies of this site. The default.' },
    { key: 'off', label: 'Off', description: 'The Whitelabel panel hides and its APIs refuse; copies already live keep running.' },
  ],
};

/**
 * Deposit email verification — a policy (owner-only). `none` (the default): deposits open as
 * before; `required`: every deposit entry point (fiat, payment orders, crypto address, P2P buy)
 * answers 403 EMAIL_NOT_VERIFIED until the player confirms a `verify-email` code sent to the
 * account's own address (user-service modules/email/depositGate.js, migration 180).
 */
const DEPOSIT_EMAIL_VERIFICATION_POLICY = {
  key: 'deposit_email_verification',
  label: 'Deposit: email must be verified first',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'none',
  variants: [
    { key: 'none', label: 'Off', description: 'Players deposit without verifying their email. The default.' },
    { key: 'required', label: 'Required', description: 'A player must verify their email (a code sent to the account\'s address) before any deposit is accepted.' },
  ],
};

/**
 * Google sign-in — a policy (owner-only). `on` (the default, the behaviour before the switch): the
 * Google button shows on login and sign-up while the server has its keys; `off`: the button hides
 * and the Google routes refuse (user-service modules/auth google). Accounts made with Google keep
 * signing in with their password.
 */
const GOOGLE_SIGNIN_POLICY = {
  key: 'google_signin',
  label: 'Google sign-in',
  category: 'business',
  kind: 'policy',
  flag: null,
  defaultVariant: 'on',
  variants: [
    { key: 'on', label: 'On', description: 'Players can sign in and sign up with Google (when the server has the Google keys). The default.' },
    { key: 'off', label: 'Off', description: 'The Google button hides on login and sign-up, and Google sign-in is refused.' },
  ],
};

const FEATURES = Object.freeze([...POLICIES, REWARD_CURRENCY_POLICY, DEFAULT_CURRENCY_POLICY, REGION_RESTRICTION_POLICY, WITHDRAWAL_REQUIREMENTS_POLICY, CASINO_AGGREGATOR_POLICY, THEME_MODE_POLICY, ADMIN_THEME_POLICY, SLOTEGRATOR_INR_AS_PKR_POLICY, API_ENCRYPTION_POLICY, RATE_LIMIT_POLICY, BRANCH_MANAGEMENT_POLICY, WHITELABEL_POLICY, DEPOSIT_EMAIL_VERIFICATION_POLICY, GOOGLE_SIGNIN_POLICY, ...GENERATED, TIPS, P2P, PUSH_NOTIFICATIONS, ANALYTICS]);

/**
 * Site templates — the bundles the OWNER picks for a site (docs/OWNER-PANEL.md
 * §2, the entitlement document's `template`). Each is a set of variants that
 * belong together; the site admin may then change any entitled feature alone,
 * but never the template itself.
 *
 * Keys and labels name a colour theme, never the site a bundle was ported
 * from: everything here can reach an operator's screen. A template key is a
 * contract like a variant key — add, do not rename; the old names live on in
 * LEGACY_TEMPLATES below.
 */
// bitcasino + smartbet: twelve colour-only palettes (Figma palettes, owner panel → Template). They
// switch the site's colours and nothing else, so every feature keeps the Original layout.
const HASH_GAME_VARIANTS = Object.freeze({
  "vip": "ring_panel",
  "promotions": "event_list",
  "spin_wheel": "none",
  "gift_cards": "redeem_dialog",
  "bonus": "reward_hub",
  "affiliate": "referral_hub",
  "races": "daily_contest",
  "challenges": "quest_hub",
  "raffles": "ticket_raffle",
  "vault": "flat_balance",
  "swap": "swap_page",
  "tips": "none",
  "p2p": "none",
  "chat": "none",
  "notifications": "notice_centre",
  "banners": "artwork_slides",
  "blog": "none",
  "casino_lobby": "tabbed_themes",
  "club_membership": "none",
  "kyc": "document_cockpit",
  "push_notifications": "none",
  "analytics": "none"
});

const TEMPLATES = Object.freeze({
    // hash-game-exchange's own: the bc.game UI with its ORIGINAL colours (the theme changes
    // nothing). Its variants are the one layout per feature that UI has; the owner panel pins
    // every feature to them (owner-panel/src/configs/siteUi.ts).
    "hash_game": {
      "label": "Default",
      "description": "Default: this site's own UI in its original colours, no theme applied. VIP, bonus, referral, promotions, daily contest, weekly raffle, quests, vault, swap, notifications, KYC and gift cards.",
      "variants": {
        "vip": "ring_panel",
        "promotions": "event_list",
        "spin_wheel": "none",
        "gift_cards": "redeem_dialog",
        "bonus": "reward_hub",
        "affiliate": "referral_hub",
        "races": "daily_contest",
        "challenges": "quest_hub",
        "raffles": "ticket_raffle",
        "vault": "flat_balance",
        "swap": "swap_page",
        "tips": "none",
        "p2p": "none",
        "chat": "none",
        "notifications": "notice_centre",
        "banners": "artwork_slides",
        "blog": "none",
        "casino_lobby": "tabbed_themes",
        "club_membership": "none",
        "kyc": "document_cockpit",
        "push_notifications": "none",
        "analytics": "none"
      }
    },
    "violet_night": {
      "label": "Violet Night",
      "description": "Violet Night: VIP program page, promotions tile grid, weekly race, flat vault, token lottery, KYC status in settings.",
      "variants": {
        "vip": "program_page",
        "promotions": "tile_grid",
        "spin_wheel": "none",
        "gift_cards": "none",
        "bonus": "reward_cards",
        "affiliate": "marketing_dashboard",
        "races": "tournaments",
        "challenges": "multiplier_grid",
        "raffles": "token_suite",
        "vault": "flat_balance",
        "swap": "none",
        "chat": "none",
        "notifications": "side_panel",
        "banners": "image_carousel",
        "blog": "tile_grid",
        "casino_lobby": "aggregator",
        "club_membership": "none",
        "kyc": "status_card",
        "push_notifications": "none"
      }
    },
    "emerald_dark": {
      "label": "Emerald Dark",
      "description": "Emerald Dark: 34-level VIP club, reward hub, quest hub, ticket raffle, drawer chat, full swap page, an external blog link.",
      "variants": {
        "vip": "ring_panel",
        "promotions": "event_list",
        "spin_wheel": "none",
        "gift_cards": "none",
        "bonus": "reward_hub",
        "affiliate": "referral_hub",
        "races": "daily_contest",
        "challenges": "quest_hub",
        "raffles": "ticket_raffle",
        "vault": "flat_balance",
        "swap": "swap_page",
        "chat": "drawer",
        "notifications": "notice_centre",
        "banners": "artwork_slides",
        "blog": "external_link",
        "casino_lobby": "tabbed_themes",
        "club_membership": "none",
        "kyc": "document_cockpit",
        "push_notifications": "none"
      }
    },
    "carbon_gold": {
      "label": "Carbon Gold",
      "description": "Carbon Gold: races, spin wheel, gift cards, chat with presence, term-lock vault, category blog.",
      "variants": {
        "vip": "club_slider",
        "promotions": "promo_cards",
        "spin_wheel": "inline_wheel",
        "gift_cards": "claim_cards",
        "bonus": "bonus_centre",
        "affiliate": "single_page",
        "races": "race_boards",
        "challenges": "live_multiplier",
        "raffles": "none",
        "vault": "term_lock",
        "swap": "wallet_tab",
        "chat": "right_rail",
        "notifications": "header_bell",
        "banners": "card_slides",
        "blog": "category_feed",
        "casino_lobby": "in_house",
        "club_membership": "none",
        "kyc": "requirement_list",
        "push_notifications": "none"
      }
    },
    "neon_navy": {
      "label": "Neon Navy",
      "description": "Neon Navy: 75-level VIP ladder, spin wheel, gift cards, bonus centre, affiliate, wallet swap and category blog; no races, chat or vault.",
      "variants": {
        "vip": "club_ladder",
        "promotions": "promo_cards",
        "spin_wheel": "inline_wheel",
        "gift_cards": "claim_cards",
        "bonus": "bonus_centre",
        "affiliate": "single_page",
        "races": "none",
        "challenges": "none",
        "raffles": "none",
        "vault": "none",
        "swap": "wallet_tab",
        "chat": "none",
        "notifications": "header_bell",
        "banners": "card_slides",
        "blog": "category_feed",
        "casino_lobby": "in_house",
        "club_membership": "none",
        "kyc": "requirement_list",
        "push_notifications": "none"
      }
    },
    "lapis_ledger": {
      "label": "Lapis Ledger",
      "description": "Lapis Ledger: colour theme only. Deep lapis buttons with an emerald sidebar.",
      "variants": HASH_GAME_VARIANTS
    },
    "seashell_teal": {
      "label": "Seashell Teal",
      "description": "Seashell Teal: colour theme only. Warm seashell ground, ocean-blue actions, emerald highlights.",
      "variants": HASH_GAME_VARIANTS
    },
    "navy_coral": {
      "label": "Navy Coral",
      "description": "Navy Coral: colour theme only. Banking navy with a slate-green sidebar and coral highlights.",
      "variants": HASH_GAME_VARIANTS
    },
    "indigo_mint": {
      "label": "Indigo Mint",
      "description": "Indigo Mint: colour theme only. Electric indigo buttons on a deep-teal sidebar, mint for wins.",
      "variants": HASH_GAME_VARIANTS
    },
    "cobalt_citrine": {
      "label": "Cobalt Citrine",
      "description": "Cobalt Citrine: colour theme only. Cobalt actions with an aquamarine sidebar and a sharp orange highlight.",
      "variants": HASH_GAME_VARIANTS
    },
    "copper_harbour": {
      "label": "Copper Harbour",
      "description": "Copper Harbour: colour theme only. Harbour slate sidebar and burnt-copper buttons.",
      "variants": HASH_GAME_VARIANTS
    },
    "wisteria": {
      "label": "Wisteria",
      "description": "Wisteria: colour theme only. Amethyst actions over a periwinkle sidebar.",
      "variants": HASH_GAME_VARIANTS
    },
    "jade_night": {
      "label": "Jade Night",
      "description": "Jade Night: colour theme only. Forest jade buttons, deep-plum sidebar.",
      "variants": HASH_GAME_VARIANTS
    },
    "magma": {
      "label": "Magma",
      "description": "Magma: colour theme only. Obsidian sidebar with one hot magma colour for actions.",
      "variants": HASH_GAME_VARIANTS
    },
    "royal_dusk": {
      "label": "Royal Dusk",
      "description": "Royal Dusk: colour theme only. Sky-blue actions on a royal-navy sidebar, ruby highlights.",
      "variants": HASH_GAME_VARIANTS
    },
    "tangerine_field": {
      "label": "Tangerine Field",
      "description": "Tangerine Field: colour theme only. Field-green actions on a linen ground, tangerine sidebar.",
      "variants": HASH_GAME_VARIANTS
    },
    "ocean_ruby": {
      "label": "Ocean Ruby",
      "description": "Ocean Ruby: colour theme only. Ocean-blue actions, emerald sidebar, ruby accents.",
      "variants": HASH_GAME_VARIANTS
    },
    // stake: its own colour-only templates (stake/frontend/src/theme/palettes.js); other sites' UIs ignore them.
    "midnight_indigo": {
      "label": "Midnight Indigo",
      "description": "Midnight Indigo: colour theme only. Ink-indigo surfaces, periwinkle actions, mint wins.",
      "variants": HASH_GAME_VARIANTS
    },
    "graphite": {
      "label": "Graphite",
      "description": "Graphite: colour theme only. Neutral charcoal, white actions, green wins.",
      "variants": HASH_GAME_VARIANTS
    },
    "emerald_vault": {
      "label": "Emerald Vault",
      "description": "Emerald Vault: colour theme only. Deep forest surfaces, emerald actions, gold highlights.",
      "variants": HASH_GAME_VARIANTS
    },
    "crimson_rush": {
      "label": "Crimson Rush",
      "description": "Crimson Rush: colour theme only. Dark wine surfaces, crimson actions, amber wins.",
      "variants": HASH_GAME_VARIANTS
    },
    "high_roller_gold": {
      "label": "High Roller Gold",
      "description": "High Roller Gold: colour theme only. VIP black-bronze surfaces with gold actions.",
      "variants": HASH_GAME_VARIANTS
    },
    "lagoon_teal": {
      "label": "Lagoon Teal",
      "description": "Lagoon Teal: colour theme only. Deep sea-teal surfaces, aqua actions, lime wins.",
      "variants": HASH_GAME_VARIANTS
    },
    "ultraviolet": {
      "label": "Ultraviolet",
      "description": "Ultraviolet: colour theme only. Night-purple surfaces, violet actions, mint wins.",
      "variants": HASH_GAME_VARIANTS
    },
    "ember_night": {
      "label": "Ember Night",
      "description": "Ember Night: colour theme only. Smoky dark-brown surfaces, ember-orange actions, green wins.",
      "variants": HASH_GAME_VARIANTS
    },
    "rose_noir": {
      "label": "Rose Noir",
      "description": "Rose Noir: colour theme only. Black-plum surfaces, hot-rose actions, sky-blue wins.",
      "variants": HASH_GAME_VARIANTS
    }
  });

/**
 * What a variant used to be called, per feature.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * The variants were named after the clone each one was built from —
 * `shuffle`, `bcgame`, `stake` — which told an operator nothing: "Stake-style
 * lobby" is not a choice anyone outside this repo can make. They are named
 * for what they ARE now (`in_house`, `aggregator`, `tabbed_themes`), and a
 * stored row still holding an old name is read through this map.
 *
 * The provenance is not lost: each variant carries `builtFor`, so the site it
 * came from is still one field away for anyone porting a screen.
 *
 * Migration 048 rewrites the rows; this map is what makes the deploy that
 * precedes it, and any client still sending an old name, keep working.
 */
const LEGACY_VARIANTS = Object.freeze({
    "vip": {
      "shuffle": "program_page",
      "bcgame": "ring_panel",
      "stake": "club_slider",
      "addaplay": "club_ladder"
    },
    "promotions": {
      "shuffle": "tile_grid",
      "bcgame": "event_list",
      "stake": "promo_cards"
    },
    "spin_wheel": {
      "stake": "inline_wheel"
    },
    "gift_cards": {
      "stake": "claim_cards"
    },
    "bonus": {
      "shuffle": "reward_cards",
      "bcgame": "reward_hub",
      "stake": "bonus_centre"
    },
    "affiliate": {
      "shuffle": "marketing_dashboard",
      "bcgame": "referral_hub",
      "stake": "single_page"
    },
    "races": {
      "shuffle": "tournaments",
      "bcgame": "daily_contest",
      "stake": "race_boards"
    },
    "challenges": {
      "shuffle": "multiplier_grid",
      "bcgame": "quest_hub",
      "stake": "live_multiplier"
    },
    "raffles": {
      "shuffle": "token_suite",
      "bcgame": "ticket_raffle"
    },
    "vault": {
      "flat": "flat_balance",
      "stake": "term_lock"
    },
    "swap": {
      "bcgame": "swap_page",
      "stake": "wallet_tab"
    },
    "chat": {
      "bcgame": "drawer",
      "stake": "right_rail"
    },
    "notifications": {
      "shuffle": "side_panel",
      "bcgame": "notice_centre",
      "stake": "header_bell"
    },
    "banners": {
      "shuffle": "image_carousel",
      "bcgame": "artwork_slides",
      "stake": "card_slides"
    },
    "blog": {
      "shuffle": "tile_grid",
      "external": "external_link",
      "stake": "category_feed"
    },
    "casino_lobby": {
      "shuffle": "aggregator",
      "bcgame": "tabbed_themes",
      "stake": "in_house"
    },
    "kyc": {
      "shuffle": "status_card",
      "bcgame": "document_cockpit",
      "stake": "requirement_list"
    }
  });

/** The current key for a variant name, old or new. Unknown names pass through. */
const resolveVariantKey = (feature, variant) => LEGACY_VARIANTS[feature]?.[variant] ?? variant;

/**
 * What a template used to be called — the clone it was built from. Same idea
 * as LEGACY_VARIANTS: a stored `_template` row, a `SITE_TEMPLATE` env value or
 * the hub's sites.json `template` field still holding an old name keeps
 * working. Migration 059 rewrites the row. Old names are never SHOWN: every
 * reader resolves first.
 */
const LEGACY_TEMPLATES = Object.freeze({
  stake: 'carbon_gold',
  shuffle: 'violet_night',
  bcgame: 'emerald_dark',
  addaplay: 'neon_navy',
});

/** The current key for a template name, old or new. Unknown names pass through. */
const resolveTemplateKey = (template) =>
  (typeof template === 'string' && Object.hasOwn(LEGACY_TEMPLATES, template) ? LEGACY_TEMPLATES[template] : template);

const FEATURE_KEYS = Object.freeze(FEATURES.map((f) => f.key));
const TEMPLATE_KEYS = Object.freeze(Object.keys(TEMPLATES));

/** The variant a feature reads when nothing is stored. */
const defaultVariantOf = (key) => featureByKey(key)?.defaultVariant ?? 'none';
const isPolicy = (key) => featureByKey(key)?.kind === 'policy';

const featureByKey = (key) => FEATURES.find((f) => f.key === key) ?? null;
const variantOf = (featureKey, variantKey) =>
  featureByKey(featureKey)?.variants.find((v) => v.key === variantKey) ?? null;

// Fail at require time, not at the first operator click, if a template names a
// feature or a variant the catalogue does not have.
for (const [name, template] of Object.entries(TEMPLATES)) {
  for (const [feature, variant] of Object.entries(template.variants)) {
    if (!variantOf(feature, variant)) {
      throw new Error(`featureCatalogue: template "${name}" sets ${feature}=${variant}, which is not a variant of that feature`);
    }
  }
}

module.exports = {
  FEATURES,
  TEMPLATES,
  FEATURE_KEYS,
  TEMPLATE_KEYS,
  featureByKey,
  variantOf,
  defaultVariantOf,
  isPolicy,
  LEGACY_VARIANTS,
  resolveVariantKey,
  LEGACY_TEMPLATES,
  resolveTemplateKey,
};
