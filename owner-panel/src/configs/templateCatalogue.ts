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
export const TEMPLATE_CATALOGUE: TemplateEntry[] = [
  {
    key: 'hash_game',
    label: 'Original',
    description: "The site's own colours. The default.",
    swatch: { accent: '#24EE89', background: '#232626' },
    colours: "The site's own colours, unchanged.",

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
