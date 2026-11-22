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

export const UI_LABEL = 'Site UI'

export type UiSupport = { status: 'toggle'; variant: string; surfaces: string } | { status: 'fixed'; variant: string; surfaces: string } | { status: 'absent'; why: string }

export const SITE_UI: Record<string, UiSupport> = {
  vip: { status: 'toggle', variant: 'ring_panel', surfaces: '/vip, /loyalty, sidebar and account menu rows' },
  promotions: { status: 'toggle', variant: 'event_list', surfaces: '/promotions and the promotion pages' },
  bonus: { status: 'toggle', variant: 'reward_hub', surfaces: '/profile/boosts, /profile/rewards, account menu rows' },
  affiliate: { status: 'toggle', variant: 'referral_hub', surfaces: '/profile/refer-a-friend, /ref/:code sign-up links' },
  races: { status: 'toggle', variant: 'daily_contest', surfaces: '/promotions/league-of-bitcasino, /tournaments' },
  challenges: { status: 'toggle', variant: 'quest_hub', surfaces: 'Daily quests block on /promotions' },
  raffles: { status: 'toggle', variant: 'ticket_raffle', surfaces: '/promotions/weekly-raffle (also needs the site admin Lotto flag)' },
  vault: { status: 'toggle', variant: 'flat_balance', surfaces: 'wallet Vault tab, Vault and Vault interest tabs in /profile/transactions' },
  swap: { status: 'toggle', variant: 'swap_page', surfaces: 'wallet Swap tab, Swaps tab in /profile/transactions' },
  notifications: { status: 'toggle', variant: 'notice_centre', surfaces: '/profile/notifications' },
  kyc: { status: 'toggle', variant: 'document_cockpit', surfaces: 'identity verification and verification levels 3-4 in /profile/account' },
  gift_cards: { status: 'toggle', variant: 'redeem_dialog', surfaces: 'redeem a code, gift card list and claimed history in /profile/rewards' },
  blog: { status: 'toggle', variant: 'category_feed', surfaces: '/blog, /blog/:slug and the links in the home copy' },

  casino_lobby: { status: 'fixed', variant: 'tabbed_themes', surfaces: 'the casino lobby is the site itself; use the Casino flag and the game-category flags' },
  banners: { status: 'fixed', variant: 'artwork_slides', surfaces: 'the home hero banners (artwork from the site admin banners)' },

  spin_wheel: { status: 'toggle', variant: 'inline_wheel', surfaces: '/promotions/spin-the-wheel with My spins (also needs the site admin Spin wheel flag)' },
  tips: { status: 'toggle', variant: 'peer_to_peer', surfaces: 'Send a tip and the Tips tab in /profile/transactions, the receive-tips switch in /profile/settings' },
  chat: { status: 'absent', why: 'No chat screen in this UI.' },
  club_membership: { status: 'absent', why: 'No club screens in this UI.' },
  push_notifications: { status: 'absent', why: 'This UI does not load a push SDK.' },
  analytics: { status: 'absent', why: 'This UI does not load a Google tag.' },
  live_tv: { status: 'toggle', variant: 'gated', surfaces: 'the TV button on an exchange match (minimum balance and inactive hours under Settings)' },
  bonus_centre: { status: 'toggle', variant: 'block', surfaces: 'Bonus centre block in /profile/boosts (needs Bonus on too)' }
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
