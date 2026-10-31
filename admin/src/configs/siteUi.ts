/**
 * What THIS client's frontend can draw — the same table as the owner panel's
 * (owner-panel/src/configs/siteUi.ts; keep the two equal). hash-game-exchange runs the fixed
 * hash-games UI, which has one layout per feature, so the Features page shows a feature as
 * "This site's UI" (no variant name), "Always on in this UI" or "Not in this UI". Staff see
 * this, so no other site's name appears in any label here.
 * The values themselves still come from the backend (the owner's document), read-only.
 */

export const UI_LABEL = "This site's UI"

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

  casino_lobby: { status: 'fixed', variant: 'tabbed_themes', surfaces: 'the casino lobby is the site itself; use the Casino flag and the game-category flags' },
  banners: { status: 'fixed', variant: 'artwork_slides', surfaces: 'the home hero carousel (artwork from the site admin banners)' },

  spin_wheel: { status: 'absent', why: 'The backend has it; this UI has no wheel screen.' },
  tips: { status: 'absent', why: 'No tip-sending screen in this UI.' },
  p2p: { status: 'absent', why: 'No P2P trading screen in this UI.' },
  chat: { status: 'absent', why: 'Chat is socket-only and this UI has no socket client.' },
  club_membership: { status: 'absent', why: 'No club screens in this UI.' },
  push_notifications: { status: 'absent', why: 'This UI does not load a push SDK.' },
  analytics: { status: 'absent', why: 'This UI does not load a Google tag.' },
  blog: { status: 'absent', why: "This UI's Blog row is a link to an off-site blog; there is no blog page." }
}

export const uiSupport = (feature: string): UiSupport | null => SITE_UI[feature] ?? null
