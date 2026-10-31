/**
 * The operator flags, grouped for the screen. Keys are the platform's
 * `siteconfig` columns — see backend services/admin/src/modules/site-config.
 * A key the backend returns that is not listed here still renders, under
 * "Other", so a new column never goes invisible.
 */
/** Yahan nahi dikhte — apni alag screen hai (sports = Settings → Site config → Sports switch). */
// The old per-studio flags (spribe, evolution …) are kept off this screen: providers are switched per
// provider from the live list in the Providers card (casino provider settings).
// The lobby's game-category switches are not offered to the site admin either (user's request, 2026-10-20).
export const FLAGS_ELSEWHERE = new Set([
  'sports',
  'spribe', 'evolution', 'pragmaticslots', 'pragmaticlive', 'ideal', 'microgaming', 'pgsoft', 'hacksawgaming', 'jili', 'jilli', 'netent',
  'crash', 'originals', 'livegames', 'slotsgames', 'alllivegames', 'allslotsgames', 'lotterygames', 'cards', 'instantgames'
])

/** A flag that belongs to an owner feature (backend featureCatalogue `flag`): off in the owner's plan → not listed. */
export const FLAG_FEATURE: Record<string, string> = {
  vipclub: 'vip',
  wheelspin: 'spin_wheel',
  giftcards: 'gift_cards',
  bonus: 'bonus',
  affiliate: 'affiliate',
  lotto: 'raffles',
  home_heroSection: 'banners',
  casino: 'casino_lobby',
  clubmembership: 'club_membership'
}

export const FLAG_GROUPS: { title: string; description: string; keys: string[] }[] = [
  {
    title: 'Products',
    description: 'Whole sections of the site. Off hides the section and its navigation.',
    keys: ['casino', 'lotto', 'vipclub', 'clubmembership', 'bonus', 'affiliate', 'giftcards', 'welcomepack', 'wheelspin', 'provablyfair']
  },
  {
    // rainbet: KYC shape (migration 170).
    title: 'Verification',
    description: 'On: KYC in levels (1–2 identity, 3 proof of address, 4 source of income). Off: one identity check with no levels.',
    keys: ['kyclevels']
  },
  {
    title: 'Fiat currencies',
    description: 'Wallet currencies a user may hold.',
    keys: ['inr', 'mvr', 'aed', 'pkr', 'bdt', 'npr', 'eur']
  },
  {
    title: 'Crypto currencies',
    description: 'Master switch first, then each coin.',
    keys: ['cryptocoin', 'btc', 'eth', 'ltc', 'bch', 'usdt', 'trx', 'doge', 'ada', 'xrp', 'bnb', 'usdp', 'nexo', 'mkr', 'tusd', 'usdc', 'busd', 'shib', 'matic', 'nc', 'sc']
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

/** The crypto master switch: when the owner leaves it out of the plan, every crypto coin is out too. */
export const CRYPTO_MASTER_FLAG = 'cryptocoin'

/** The per-coin crypto flags (the "Crypto currencies" group after its master switch). */
export const CRYPTO_COIN_FLAGS = new Set(FLAG_GROUPS.find(g => g.keys.includes(CRYPTO_MASTER_FLAG))?.keys.filter(k => k !== CRYPTO_MASTER_FLAG) ?? [])

export const FLAG_LABELS: Record<string, string> = {
  casino: 'Casino',
  sports: 'Sports (kill switch)',
  lotto: 'Lottery',
  vipclub: 'VIP club',
  clubmembership: 'Club membership',
  bonus: 'Bonus programme',
  affiliate: 'Affiliate / referral',
  giftcards: 'Gift cards',
  welcomepack: 'Welcome pack',
  wheelspin: 'Spin wheel',
  provablyfair: 'Provably fair',
  kyclevels: 'KYC in levels',
  crash: 'Crash games',
  originals: 'Originals',
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
