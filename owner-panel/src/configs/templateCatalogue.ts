/**
 * The site templates the owner picks from — contract §2 (`template` in the entitlements document).
 *
 * Mirrors the backend's TEMPLATES (backend/packages/common/src/featureCatalogue.js): same keys,
 * same variants. Templates are named for their colour theme, never after another site. The
 * site admin only shows the active one; choosing it is the owner's call.
 *
 * `swatch` is a preview only (accent on background) — the site's real tokens live in its theme.
 * Keys are a contract with the backend: add, never rename. A renamed key goes in LEGACY_TEMPLATES.
 */

export type TemplateEntry = {
  key: string
  label: string
  description: string
  swatch: { accent: string; background: string }

  /** What it does on THIS client's UI (the bc.game UI): its colours only, frontend/src/theme/palettes.css. */
  colours: string

  /** feature key → variant key; 'none' = switched off by this template. */
  variants: Record<string, string>
}

/*
 * ON THIS CLIENT a template is a COLOUR THEME. The frontend is the fixed bc.game UI: it maps the
 * template's palette onto its own colour tokens (frontend/src/theme/palettes.css) and keeps its one
 * layout per feature, so a template never switches a feature or a variant here
 * (configs/siteUi.ts). `variants` stay for the backend's own catalogue (same keys there).
 */
/** The Original layout per feature: the colour-only palettes below keep it. */
const ORIGINAL_VARIANTS: Record<string, string> = {
  vip: 'ring_panel',
  promotions: 'event_list',
  spin_wheel: 'none',
  gift_cards: 'redeem_dialog',
  bonus: 'reward_hub',
  affiliate: 'referral_hub',
  races: 'daily_contest',
  challenges: 'quest_hub',
  raffles: 'ticket_raffle',
  vault: 'flat_balance',
  swap: 'swap_page',
  tips: 'none',
  p2p: 'none',
  chat: 'none',
  notifications: 'notice_centre',
  banners: 'artwork_slides',
  blog: 'none',
  casino_lobby: 'tabbed_themes',
  club_membership: 'none',
  kyc: 'document_cockpit',
  push_notifications: 'none',
  analytics: 'none'
}

export const TEMPLATE_CATALOGUE: TemplateEntry[] = [
  {
    key: 'hash_game',
    label: 'Original',
    description: "The site's own colours (bitcasino.io's default). The default.",
    swatch: { accent: '#F2590D', background: '#FFFFFF' },
    colours: "bitcasino.io's default: orange #F2590D on white, light mode.",

    // The one layout per feature the bc.game UI has (configs/siteUi.ts; same as the backend's hash_game).
    variants: {
      vip: 'ring_panel',
      promotions: 'event_list',
      spin_wheel: 'none',
      gift_cards: 'redeem_dialog',
      bonus: 'reward_hub',
      affiliate: 'referral_hub',
      races: 'daily_contest',
      challenges: 'quest_hub',
      raffles: 'ticket_raffle',
      vault: 'flat_balance',
      swap: 'swap_page',
      tips: 'none',
      p2p: 'none',
      chat: 'none',
      notifications: 'notice_centre',
      banners: 'artwork_slides',
      blog: 'none',
      casino_lobby: 'tabbed_themes',
      club_membership: 'none',
      kyc: 'document_cockpit',
      push_notifications: 'none',
      analytics: 'none'
    }
  },
  {
    key: 'carbon_gold',
    colours: 'Hazard yellow on carbon black.',
    label: 'Carbon Gold',
    description: 'Carbon Gold: races, spin wheel, gift cards, chat with presence, term-lock vault, category blog.',
    swatch: { accent: '#FCEE0A', background: '#0B0B0B' },
    variants: {
      vip: 'club_slider',
      promotions: 'promo_cards',
      spin_wheel: 'inline_wheel',
      gift_cards: 'claim_cards',
      bonus: 'bonus_centre',
      affiliate: 'single_page',
      races: 'race_boards',
      challenges: 'live_multiplier',
      raffles: 'none',
      vault: 'term_lock',
      swap: 'wallet_tab',
      chat: 'right_rail',
      notifications: 'header_bell',
      banners: 'card_slides',
      blog: 'category_feed',
      casino_lobby: 'in_house',
      club_membership: 'none',
      kyc: 'requirement_list',
      push_notifications: 'none'
    }
  },
  {
    key: 'violet_night',
    colours: 'Soft violet on deep plum.',
    label: 'Violet Night',
    description:
      'Violet Night: VIP program page, promotions tile grid, weekly race, flat vault, token lottery, KYC status in settings.',
    swatch: { accent: '#8B5CF6', background: '#0F0A1E' },
    variants: {
      vip: 'program_page',
      promotions: 'tile_grid',
      spin_wheel: 'none',
      gift_cards: 'none',
      bonus: 'reward_cards',
      affiliate: 'marketing_dashboard',
      races: 'tournaments',
      challenges: 'multiplier_grid',
      raffles: 'token_suite',
      vault: 'flat_balance',
      swap: 'none',
      chat: 'none',
      notifications: 'side_panel',
      banners: 'image_carousel',
      blog: 'tile_grid',
      casino_lobby: 'aggregator',
      club_membership: 'none',
      kyc: 'status_card',
      push_notifications: 'none'
    }
  },
  {
    key: 'emerald_dark',
    colours: 'Emerald green on near-black green.',
    label: 'Emerald Dark',
    description:
      'Emerald Dark: 34-level VIP club, reward hub, quest hub, ticket raffle, drawer chat, full swap page, an external blog link.',
    swatch: { accent: '#22C55E', background: '#0B0F0C' },
    variants: {
      vip: 'ring_panel',
      promotions: 'event_list',
      spin_wheel: 'none',
      gift_cards: 'none',
      bonus: 'reward_hub',
      affiliate: 'referral_hub',
      races: 'daily_contest',
      challenges: 'quest_hub',
      raffles: 'ticket_raffle',
      vault: 'flat_balance',
      swap: 'swap_page',
      chat: 'drawer',
      notifications: 'notice_centre',
      banners: 'artwork_slides',
      blog: 'external_link',
      casino_lobby: 'tabbed_themes',
      club_membership: 'none',
      kyc: 'document_cockpit',
      push_notifications: 'none'
    }
  },
  {
    key: 'neon_navy',
    colours: 'Neon green on midnight navy.',
    label: 'Neon Navy',
    description:
      'Neon Navy: 75-level VIP ladder, spin wheel, gift cards, bonus centre, affiliate, wallet swap and category blog; no races, chat or vault.',
    swatch: { accent: '#1AFF00', background: '#0B0F1A' },
    variants: {
      vip: 'club_ladder',
      promotions: 'promo_cards',
      spin_wheel: 'inline_wheel',
      gift_cards: 'claim_cards',
      bonus: 'bonus_centre',
      affiliate: 'single_page',
      races: 'none',
      challenges: 'none',
      raffles: 'none',
      vault: 'none',
      swap: 'wallet_tab',
      chat: 'none',
      notifications: 'header_bell',
      banners: 'card_slides',
      blog: 'category_feed',
      casino_lobby: 'in_house',
      club_membership: 'none',
      kyc: 'requirement_list',
      push_notifications: 'none'
    }
  },
  {
    key: 'lapis_ledger',
    label: 'Lapis Ledger',
    description: 'Lapis Ledger: colour theme only; every feature stays as Original.',
    colours: 'Deep lapis buttons with an emerald sidebar.',
    swatch: { accent: '#678AF4', background: '#14181F' },
    variants: ORIGINAL_VARIANTS
  },
  {
    key: 'seashell_teal',
    label: 'Seashell Teal',
    description: 'Seashell Teal: colour theme only; every feature stays as Original.',
    colours: 'Warm seashell ground, ocean-blue actions, emerald highlights.',
    swatch: { accent: '#2A8FC0', background: '#141A1C' },
    variants: ORIGINAL_VARIANTS
  },
  {
    key: 'navy_coral',
    label: 'Navy Coral',
    description: 'Navy Coral: colour theme only; every feature stays as Original.',
    colours: 'Banking navy with a slate-green sidebar and coral highlights.',
    swatch: { accent: '#3B87D6', background: '#12171C' },
    variants: ORIGINAL_VARIANTS
  },
  {
    key: 'indigo_mint',
    label: 'Indigo Mint',
    description: 'Indigo Mint: colour theme only; every feature stays as Original.',
    colours: 'Electric indigo buttons on a deep-teal sidebar, mint for wins.',
    swatch: { accent: '#6E76F0', background: '#121428' },
    variants: ORIGINAL_VARIANTS
  },
  {
    key: 'cobalt_citrine',
    label: 'Cobalt Citrine',
    description: 'Cobalt Citrine: colour theme only; every feature stays as Original.',
    colours: 'Cobalt actions with an aquamarine sidebar and a sharp orange highlight.',
    swatch: { accent: '#4C6CE0', background: '#10141F' },
    variants: ORIGINAL_VARIANTS
  },
  {
    key: 'copper_harbour',
    label: 'Copper Harbour',
    description: 'Copper Harbour: colour theme only; every feature stays as Original.',
    colours: 'Harbour slate sidebar and burnt-copper buttons.',
    swatch: { accent: '#D6794D', background: '#161616' },
    variants: ORIGINAL_VARIANTS
  },
  {
    key: 'wisteria',
    label: 'Wisteria',
    description: 'Wisteria: colour theme only; every feature stays as Original.',
    colours: 'Amethyst actions over a periwinkle sidebar.',
    swatch: { accent: '#A27BC4', background: '#17141C' },
    variants: ORIGINAL_VARIANTS
  },
  {
    key: 'jade_night',
    label: 'Jade Night',
    description: 'Jade Night: colour theme only; every feature stays as Original.',
    colours: 'Forest jade buttons, deep-plum sidebar.',
    swatch: { accent: '#429155', background: '#141414' },
    variants: ORIGINAL_VARIANTS
  },
  {
    key: 'magma',
    label: 'Magma',
    description: 'Magma: colour theme only; every feature stays as Original.',
    colours: 'Obsidian sidebar with one hot magma colour for actions.',
    swatch: { accent: '#FE3B15', background: '#141417' },
    variants: ORIGINAL_VARIANTS
  },
  {
    key: 'royal_dusk',
    label: 'Royal Dusk',
    description: 'Royal Dusk: colour theme only; every feature stays as Original.',
    colours: 'Sky-blue actions on a royal-navy sidebar, ruby highlights.',
    swatch: { accent: '#0C8EF4', background: '#111723' },
    variants: ORIGINAL_VARIANTS
  },
  {
    key: 'tangerine_field',
    label: 'Tangerine Field',
    description: 'Tangerine Field: colour theme only; every feature stays as Original.',
    colours: 'Field-green actions on a linen ground, tangerine sidebar.',
    swatch: { accent: '#3E9A6D', background: '#151715' },
    variants: ORIGINAL_VARIANTS
  },
  {
    key: 'ocean_ruby',
    label: 'Ocean Ruby',
    description: 'Ocean Ruby: colour theme only; every feature stays as Original.',
    colours: 'Ocean-blue actions, emerald sidebar, ruby accents.',
    swatch: { accent: '#2E86DE', background: '#10161C' },
    variants: ORIGINAL_VARIANTS
  }
]

export const TEMPLATE_KEYS = TEMPLATE_CATALOGUE.map(t => t.key)

/** What a document without `template` runs today. Written on the next save, never on read. */
export const DEFAULT_TEMPLATE = 'hash_game'

/** Old template keys still found in stored documents, SITE_TEMPLATE values and hub sites.json. */
const LEGACY_TEMPLATES: Record<string, string> = {
  stake: 'carbon_gold',
  shuffle: 'violet_night',
  bcgame: 'emerald_dark',
  addaplay: 'neon_navy'
}

/** The current key for a template name, old or new. Unknown names pass through. */
export const resolveTemplateKey = (key: string) => LEGACY_TEMPLATES[key] ?? key

export const templateByKey = (key: string | null | undefined) =>
  key ? (TEMPLATE_CATALOGUE.find(t => t.key === resolveTemplateKey(key)) ?? null) : null

export const templateLabel = (key: string | null | undefined) => (key ? (templateByKey(key)?.label ?? key) : 'Not set')
