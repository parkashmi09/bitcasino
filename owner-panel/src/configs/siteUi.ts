/**
 * What THIS client's frontend can draw — and so what the owner panel offers for it.
 *
 * hash-game-exchange runs the fixed bc.game UI (`frontend/`, copied from cfz/hash-games). It has
 * one layout per feature, so a SmartBet layout "variant" changes nothing there; only ON/OFF and
 * the policies do. Each catalogue feature is one of:
 *
 *   toggle  the UI renders it and hides it when off (frontend/src/services/gates.js GATES). The
 *           owner gets an ON/OFF switch only; the variant is pinned to `variant` ("bc.game UI").
 *   fixed   part of the UI that cannot be hidden here (the casino lobby, the home hero). Always on,
 *           pinned to `variant`; no switch, because "off" would leave a visible section that the
 *           backend refuses.
 *   absent  the UI has no screen for it (frontend/docs/backend-gaps.md). Shown as "Not in this UI",
 *           always off (variant `none`), so the backend refuses it too.
 *
 * `variant` is the backend catalogue key the site row is stored with (a valid variant of that
 * feature, the bc.game-ported one). The owner's save pins every row to this table
 * (`pinToUi` in lib/entitlements/store.ts), so the document can never say otherwise.
 */

export const UI_LABEL = 'bc.game UI'

export type UiSupport = { status: 'toggle'; variant: string; surfaces: string } | { status: 'fixed'; variant: string; surfaces: string } | { status: 'absent'; why: string }

export const SITE_UI: Record<string, UiSupport> = {
  vip: { status: 'toggle', variant: 'ring_panel', surfaces: '/vip, /vip-detail, sidebar and account menu rows' },
  promotions: { status: 'toggle', variant: 'event_list', surfaces: '/promotions, /deposit-offer' },
  bonus: { status: 'toggle', variant: 'reward_hub', surfaces: '/bonus, sidebar and account menu rows' },
  affiliate: { status: 'toggle', variant: 'referral_hub', surfaces: '/referral, /referral-exhibition' },
  races: { status: 'toggle', variant: 'daily_contest', surfaces: '/promotions/daily-contest' },
  challenges: { status: 'toggle', variant: 'quest_hub', surfaces: '/quests' },
  raffles: { status: 'absent', why: 'No raffle in this backend; the weekly raffle page is hidden.' },
  vault: { status: 'toggle', variant: 'flat_balance', surfaces: 'wallet Vault Pro tab, /wallet/vault' },
  swap: { status: 'toggle', variant: 'swap_page', surfaces: 'wallet Swap tab, /wallet/swap' },
  notifications: { status: 'toggle', variant: 'notice_centre', surfaces: '/notification' },
  kyc: { status: 'toggle', variant: 'document_cockpit', surfaces: '/settings/verify' },
  gift_cards: { status: 'toggle', variant: 'redeem_dialog', surfaces: 'sidebar Gift Card card and redeem dialog' },
  blog: { status: 'toggle', variant: 'category_feed', surfaces: '/blog, /blog/:slug, sidebar Blog row and footer News link' },

  casino_lobby: { status: 'fixed', variant: 'tabbed_themes', surfaces: 'the casino lobby is the site itself; use the Casino flag and the game-category flags' },
  banners: { status: 'fixed', variant: 'artwork_slides', surfaces: 'the home hero carousel (artwork from the site admin banners)' },

  spin_wheel: { status: 'absent', why: 'The backend has it; this UI has no wheel screen.' },
  tips: { status: 'absent', why: 'No tip-sending screen in this UI.' },
  p2p: { status: 'absent', why: 'No P2P trading screen in this UI.' },
  chat: { status: 'absent', why: 'Chat is socket-only and this UI has no socket client.' },
  club_membership: { status: 'absent', why: 'No club screens in this UI.' },
  push_notifications: { status: 'absent', why: 'This UI does not load a push SDK.' },
  analytics: { status: 'absent', why: 'This UI does not load a Google tag.' }
}

/** Owner options that do nothing in this UI (their page does not exist here). Hidden, value kept. */
export const HIDDEN_OPTIONS = new Set(['races.tournaments_page'])

export const uiSupport = (feature: string): UiSupport | null => SITE_UI[feature] ?? null

/** The variant this UI pins a feature to when it is on; `none` for a feature it does not have. */
export const pinnedVariant = (feature: string): string | null => {
  const s = SITE_UI[feature]

  if (!s) return null

  return s.status === 'absent' ? 'none' : s.variant
}

/**
 * Pins a document's features and variants to this UI. A toggle keeps the owner's ON/OFF; a fixed
 * feature is always on; an absent one always off. Policies and unknown keys pass through.
 */
export function pinToUi(features: Record<string, boolean>, variants: Record<string, string>) {
  const f = { ...features }
  const v = { ...variants }

  for (const [key, s] of Object.entries(SITE_UI)) {
    if (s.status === 'absent') {
      v[key] = 'none'
      f[key] = false
    } else {
      v[key] = s.variant
      if (s.status === 'fixed') f[key] = true
    }
  }

  return { features: f, variants: v }
}
