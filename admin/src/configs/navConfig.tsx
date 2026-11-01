import type { ComponentType, SVGProps } from 'react'

import { siteConfig } from '@/configs/site'

import {
  LunoActivity,
  LunoArrowBigUp,
  LunoArrowDownToLine,
  LunoArrowUpFromLine,
  LunoBadgeDollar,
  LunoBanknote,
  LunoBell,
  LunoBellRing,
  LunoBitcoin,
  LunoBookOpen,
  LunoBookUser,
  LunoBuilding,
  LunoCalendar,
  LunoChartColumn,
  LunoChartPie,
  LunoCircleUser,
  LunoClipboardList,
  LunoContact,
  LunoCreditCard,
  LunoCrown,
  LunoDice,
  LunoDisc,
  LunoFileSpreadsheet,
  LunoFlag,
  LunoGamepad,
  LunoGauge,
  LunoGavel,
  LunoGift,
  LunoGlobe,
  LunoHandCoins,
  LunoHandshake,
  LunoHistory,
  LunoHouse,
  LunoImage,
  LunoKey,
  LunoLandmark,
  LunoLayoutDashboard,
  LunoLayoutGrid,
  LunoLayoutTemplate,
  LunoLink,
  LunoListOrdered,
  LunoLock,
  LunoLockKeyhole,
  LunoMail,
  LunoMegaphone,
  LunoNetwork,
  LunoNewspaper,
  LunoPalette,
  LunoPartyPopper,
  LunoPercent,
  LunoPower,
  LunoRadio,
  LunoReceipt,
  LunoRepeat,
  LunoRotateCw,
  LunoScale,
  LunoScroll,
  LunoSend,
  LunoServer,
  LunoSettings,
  LunoShield,
  LunoShieldAlert,
  LunoSliders,
  LunoSpade,
  LunoSparkles,
  LunoSquarePen,
  LunoTarget,
  LunoTeam,
  LunoTicket,
  LunoToggle,
  LunoTransfer,
  LunoTrendingUp,
  LunoTrophy,
  LunoTune,
  LunoUserCheck,
  LunoUsers,
  LunoVault,
  LunoWallet
} from '@/components/icons/luno'

/**
 * The sidebar's icons, imported by name.
 *
 * Indexing `import * as Icon from 'lucide-react'` by a string pulled the WHOLE
 * icon set (~5 MB in dev, ~1,500 modules) into the shell chunk every page
 * loads — the bulk of the slow first load. Add an icon here to use it below.
 */
export const navIcons = {
  Activity: LunoActivity,
  ArrowBigUp: LunoArrowBigUp,
  ArrowDownToLine: LunoArrowDownToLine,
  ArrowLeftRight: LunoTransfer,
  ArrowRightLeft: LunoTransfer,
  ArrowUpFromLine: LunoArrowUpFromLine,
  BadgeDollarSign: LunoBadgeDollar,
  Banknote: LunoBanknote,
  Bell: LunoBell,
  BellRing: LunoBellRing,
  Bitcoin: LunoBitcoin,
  BookOpen: LunoBookOpen,
  BookUser: LunoBookUser,
  Building2: LunoBuilding,
  CalendarDays: LunoCalendar,
  ChartColumn: LunoChartColumn,
  ChartPie: LunoChartPie,
  CircleUserRound: LunoCircleUser,
  ClipboardList: LunoClipboardList,
  Contact: LunoContact,
  CreditCard: LunoCreditCard,
  Crown: LunoCrown,
  Dices: LunoDice,
  Disc3: LunoDisc,
  FileSpreadsheet: LunoFileSpreadsheet,
  Flag: LunoFlag,
  Gamepad2: LunoGamepad,
  Gauge: LunoGauge,
  Gavel: LunoGavel,
  Gift: LunoGift,
  Globe: LunoGlobe,
  HandCoins: LunoHandCoins,
  Handshake: LunoHandshake,
  History: LunoHistory,
  House: LunoHouse,
  Image: LunoImage,
  KeyRound: LunoKey,
  Landmark: LunoLandmark,
  LayoutDashboard: LunoLayoutDashboard,
  LayoutGrid: LunoLayoutGrid,
  LayoutTemplate: LunoLayoutTemplate,
  Link: LunoLink,
  ListOrdered: LunoListOrdered,
  Lock: LunoLock,
  LockKeyhole: LunoLockKeyhole,
  Mail: LunoMail,
  Megaphone: LunoMegaphone,
  Network: LunoNetwork,
  Newspaper: LunoNewspaper,
  Palette: LunoPalette,
  PartyPopper: LunoPartyPopper,
  Percent: LunoPercent,
  Power: LunoPower,
  Radio: LunoRadio,
  ReceiptText: LunoReceipt,
  Repeat: LunoRepeat,
  RotateCw: LunoRotateCw,
  Scale: LunoScale,
  ScrollText: LunoScroll,
  Send: LunoSend,
  Server: LunoServer,
  Settings: LunoSettings,
  Settings2: LunoTune,
  ShieldAlert: LunoShieldAlert,
  ShieldCheck: LunoShield,
  SlidersHorizontal: LunoSliders,
  Spade: LunoSpade,
  Sparkles: LunoSparkles,
  SquarePen: LunoSquarePen,
  Target: LunoTarget,
  Ticket: LunoTicket,
  ToggleRight: LunoToggle,
  TrendingUp: LunoTrendingUp,
  Trophy: LunoTrophy,
  UserRoundCheck: LunoUserCheck,
  Users: LunoUsers,
  UsersRound: LunoTeam,
  Vault: LunoVault,
  Wallet: LunoWallet
} satisfies Record<string, ComponentType<SVGProps<SVGSVGElement>>>

type IconName = keyof typeof navIcons

export type MenuLeafSubItem = {
  icon?: IconName
  label: string
  href: string
  activePath?: string
  badge?: string
  badgeClassName?: string
  target?: '_blank' | '_self' | '_parent' | '_top'

  /** Any one of these grants shows the entry. Absent = everyone signed in. */
  permission?: string | string[]

  /** Hidden when this operator flag is off (`sports`, `casino`, …) or the owner left it out of the plan. */
  flag?: string

  /**
   * Hidden only when the OWNER left this flag out of the plan (`entitlements.flags[x] === false`).
   * The operator's own switch is ignored, so a screen that turns the flag back on stays reachable.
   */
  ownerFlag?: string

  /** Hidden when the owner left this feature (`vault`, `gift_cards`, …) out of the plan. */
  feature?: string

  /** Shown only to this kind of session (`marketing` = a marketing sub-login). */
  account?: 'marketing'

  /** A promotions screen (or the vault, or swap history): hidden from agent-tree logins (staff levels 4–6 and their executives). */
  promotions?: boolean

  /** A direct-user screen: only the Super Admin and its executives (`actor.direct`). */
  direct?: boolean

  /** A downline screen: only staff below the Super Admin side (hidden where `actor.direct`). */
  tree?: boolean

  /** Hidden unless this owner on/off policy (`branch_management`, …) is on. */
  policy?: string
}

export type MenuGroupSubItem = {
  icon?: IconName
  label: string
  childItems: MenuLeafSubItem[]
  permission?: string | string[]
  flag?: string
  ownerFlag?: string
  feature?: string
  account?: 'marketing'
  promotions?: boolean

  /** A direct-user screen: only the Super Admin and its executives (`actor.direct`). */
  direct?: boolean
}

export type MenuSubItem = MenuLeafSubItem | MenuGroupSubItem

export type MenuItem = {
  icon: IconName
  label: string
  permission?: string | string[]
  flag?: string
  ownerFlag?: string
  feature?: string
  account?: 'marketing'
  promotions?: boolean

  /** A direct-user screen: only the Super Admin and its executives (`actor.direct`). */
  direct?: boolean

  /** A downline screen: only staff below the Super Admin side (hidden where `actor.direct`). */
  tree?: boolean

  /** Staff's own logins only — an executive session never sees it. */
  notExecutive?: boolean

  /** Hidden unless this owner on/off policy (`branch_management`, …) is on. */
  policy?: string
} & (
  | {
      href: string
      badge?: string
      badgeClassName?: string
      childItems?: never
      target?: '_blank' | '_self' | '_parent' | '_top'
    }
  | {
      href?: never
      badge?: string
      badgeClassName?: string
      childItems: MenuSubItem[]
    }
)

export type NavItem = {
  groupLabel?: string

  /** Section heading ke bagal ka icon (zip jaisa har section/item ka apna icon). */
  groupIcon?: IconName

  /** true: group ka label click karke poora section khulta / band hota hai (dropdown jaisa). */
  collapsible?: boolean
  items: MenuItem[]
}

/**
 * The operator menu. Permissions are the platform's `resource:action` grants
 * (see ADMIN-FEATURE-INVENTORY.md); the sidebar hides what the current role
 * cannot reach and the page still refuses server-side, so this is a courtesy,
 * not the guard. Each `permission` is the backend guard of the GET the page
 * loads first — most promotion reads (bonus, codes, gift cards, wheel, VIP,
 * affiliate, races, vault) are `reports:read`, P2P reads are `config:write`.
 */
/** Wallet dekhne ki koi bhi permission (Agent System dashboard tab, bank, point ledger). */
const WALLET_ANY = ['wallet:credit', 'wallet:debit', 'wallet:adjust', 'users:read']

export const navItems: NavItem[] = [
  {
    // Main: Dashboard (Direct Users + Agent System tab), Users (Direct / Agent / Financial) aur Wallets (zip jaisa Direct User Wallet).
    groupLabel: 'Main',
    groupIcon: 'LayoutGrid',
    collapsible: true,
    items: [
      { icon: 'LayoutDashboard', label: 'Dashboard', href: '/dashboard', permission: ['reports:read', ...WALLET_ANY], direct: true },

      // Either grant opens the list: reports:read reads `admin/reports/players` (balances, deposits,
      // wagers); users:read alone falls back to the player directory `admin/user/directory`.
      { icon: 'Users', label: 'Users', href: '/users', activePath: '/users', permission: ['reports:read', 'users:read'], direct: true } as MenuItem,
      { icon: 'Wallet', label: 'Wallets', href: '/wallets', permission: 'wallet:adjust', direct: true },
      { icon: 'Globe', label: 'Login & IP history', href: '/ip-tracker', permission: 'reports:read', direct: true },

      // Zip ke Main jaisa: Redeem Codes (Promotions se yahan) aur Turnover Report (direct users ka wager vs target).
      { icon: 'Ticket', label: 'Redeem Codes', href: '/redeem-codes', permission: 'reports:read', promotions: true },
      { icon: 'Activity', label: 'Turnover Report', href: '/turnover-report', permission: 'reports:read', promotions: true, direct: true }
    ]
  },
  {
    // Sports Exchange ka agent system — sidebar me alag section. Create Account Account List ke button se.
    // Not tied to a sports mode: agents' players bet on the exchange or on the sportsbook (JSGames books
    // their bets into the same point ledger, category CASINO), so the agent system works in both.
    groupLabel: 'Agent Management',
    groupIcon: 'Network',
    collapsible: true,
    items: [
      { icon: 'LayoutDashboard', label: 'Dashboard', href: '/exchange/dashboard', permission: WALLET_ANY },
      { icon: 'BookUser', label: 'Account List', href: '/exchange/users', activePath: '/exchange/users', permission: ['users:read', 'staff:read'] } as MenuItem,
      { icon: 'Landmark', label: 'Bank', href: '/exchange/bank', permission: WALLET_ANY },

      // Every staff login (Super Admin down to Agent) makes its own executives (user, 2026-10-17).
      { icon: 'KeyRound', label: 'Executives', href: '/access/executives', notExecutive: true },
      { icon: 'ScrollText', label: 'Activity log', href: '/audit', permission: 'audit:read' },

      // Agent ke reports.
      { icon: 'ReceiptText', label: 'Account Statement', href: '/exchange/reports/account-statement', permission: 'reports:read' },
      { icon: 'Scale', label: 'Party Win Loss', href: '/exchange/reports/party-win-loss', permission: 'reports:read' },
      { icon: 'TrendingUp', label: 'Total Profit Loss', href: '/exchange/reports/total-profit-loss', permission: 'reports:read' },
      { icon: 'UserRoundCheck', label: 'User Win Loss', href: '/exchange/reports/user-win-loss', permission: 'reports:read' },
      { icon: 'Lock', label: 'General Lock', href: '/exchange/reports/general-lock', permission: 'reports:read' }
    ]
  },
  {
    // Owner policy `branch_management`: branches with their own login (/branch), Super Admin only.
    groupLabel: 'Branch Management',
    groupIcon: 'Building2',
    collapsible: true,
    items: [
      { icon: 'Building2', label: 'Branches', href: '/branches', activePath: '/branches', permission: 'reports:read', direct: true, policy: 'branch_management' } as MenuItem,
      { icon: 'ChartColumn', label: 'Branch Report', href: '/branch-report', permission: 'reports:read', direct: true, policy: 'branch_management' }
    ]
  },

  // Whitelabel copies of this site (admin modules/whitelabels), Super Admin only — never on a copy itself.
  // On a copy: the company's own revenue-share statement (admin modules/whitelabel-statement).
  ...(siteConfig.whitelabel
    ? [
        {
          groupLabel: 'Whitelabel',
          groupIcon: 'Globe',
          collapsible: true,
          items: [{ icon: 'ChartColumn', label: 'Revenue share', href: '/revenue-share', permission: 'reports:read', direct: true } as MenuItem]
        } as NavItem
      ]
    : [
        {
          groupLabel: 'Whitelabel',
          groupIcon: 'Globe',
          collapsible: true,
          items: [
            { icon: 'Globe', label: 'Whitelabels', href: '/whitelabels', activePath: '/whitelabels', permission: 'reports:read', direct: true, policy: 'whitelabel' } as MenuItem,
            { icon: 'ChartColumn', label: 'Revenue share report', href: '/whitelabels/report', permission: 'reports:read', direct: true, policy: 'whitelabel' } as MenuItem
          ]
        } as NavItem
      ]),
  {
    /*
     * Sports Exchange — zip (msadmin) ke admin panel ke saare screens, usi order me jaise zip ke
     * sidebar me the; jo zip me sub-menu the (Account, Reports, Settlement) wo yahan bhi sub-menu
     * hain. Casino ka kuch nahi. Sabka balance `credits` table me hai (owner, staff, player).
     */
    // Everything sports lives here. Exchange screens carry `ownerFlag: 'sportsexchange'` and hide
    // when the owner runs the sportsbook (owner panel → Products); the switch shows in both modes.
    groupLabel: 'Sports',
    groupIcon: 'Trophy',
    collapsible: true,
    items: [
      { icon: 'ChartColumn', label: 'Market Analysis', href: '/exchange/market-analysis', ownerFlag: 'sportsexchange', permission: 'sports:read' },
      { icon: 'Radio', label: 'Current Bets', href: '/exchange/reports/current-bets', ownerFlag: 'sportsexchange', permission: 'reports:read' },
      { icon: 'RotateCw', label: 'Turn Over', href: '/exchange/reports/turnover', ownerFlag: 'sportsexchange', permission: 'reports:read' },

      // Zip me owner only. Casino Settlement nahi. Match / Fancy / Void Bets ek page pe tabs me.
      { icon: 'Gavel', label: 'Settlement', href: '/exchange/settlement', ownerFlag: 'sportsexchange', permission: 'sports:settle', direct: true },

      // Zip me owner only (sports config): Buffer Time, Commission, Max Odds, Auto Void, Virtual / Bet Limits — tabs me.
      { icon: 'SlidersHorizontal', label: 'Global Settings', href: '/exchange/settings', ownerFlag: 'sportsexchange', permission: 'sports:manage', direct: true },
      { icon: 'CalendarDays', label: 'Events', href: '/exchange/events', ownerFlag: 'sportsexchange', permission: 'sports:read' },

      // Super Admin's on/off; hidden when the owner has sports off (owner panel → Site flags).
      { icon: 'Power', label: 'Sports switch', href: '/exchange/sports-switch', permission: 'config:write', ownerFlag: 'sports', direct: true }
    ]
  },
  {
    /*
     * Transactions — admin-structure.zip jaisa: Deposit, Withdraw (dono me Direct Users / Agent Users tab)
     * aur Account Statement. Purane Fiat / Crypto / Payment orders screens Direct Users tab ke andar.
     */
    groupLabel: 'Transactions',
    groupIcon: 'ArrowLeftRight',
    collapsible: true,

    // Staff below the Super Admin see Deposit and Withdraw of their own hierarchy (the Agent System tab); the rest is house only.
    items: [
      { icon: 'ArrowDownToLine', label: 'Deposit', href: '/transactions/deposit', permission: ['deposits:read', 'users:read'] },
      { icon: 'ArrowUpFromLine', label: 'Withdraw', href: '/transactions/withdraw', permission: ['withdrawals:read', 'users:read'] },

      // The transfer list is `admin/accounts/statement` (users:read); the drill-down is `admin/statements` (reports:read).
      { icon: 'BookOpen', label: 'Account Statement', href: '/reports/statements', permission: ['users:read', 'reports:read'], promotions: true, direct: true },

      // Users section se yahan: KYC aur Bank details (routes wahi).
      { icon: 'ShieldCheck', label: 'KYC', href: '/kyc', permission: 'users:read', feature: 'kyc', promotions: true, direct: true },
      { icon: 'Building2', label: 'Bank details', href: '/bank-details', permission: 'config:read', promotions: true }
    ]
  },
  {
    groupLabel: 'Finance',
    groupIcon: 'Banknote',
    collapsible: true,
    items: [
      { icon: 'ArrowRightLeft', label: 'Exchange rates', href: '/exchange-rates', permission: 'config:read' },

      // House only: `promotions` is the mark that hides a screen from agent-tree logins.
      { icon: 'Bitcoin', label: 'Coins', href: '/coins', permission: 'config:read', promotions: true },
      { icon: 'Vault', label: 'Vault', href: '/vault', permission: 'reports:read', promotions: true, feature: 'vault' },

      // Casino se Finance me (user, 2026-10-20); route wahi. `GET admin/reports/wager-stats` is reports:read and tree-scoped, so staff see their own hierarchy.
      { icon: 'FileSpreadsheet', label: 'Wager report', href: '/casino/wager-report', permission: 'reports:read', flag: 'casino' },
      {
        icon: 'Repeat',
        label: 'Swap history',
        href: '/swap',
        permission: 'wallet:read',
        promotions: true,
        feature: 'swap'
      },

      // Player-to-player tips (read-only). Hidden when the owner left `tips` out of the plan.
      { icon: 'HandCoins', label: 'Tips', href: '/tips', permission: 'reports:read', feature: 'tips', direct: true }

      // P2P trading is off for now: its backend module is unmounted (modules/_p2p), so no menu entry.
    ]
  },
  {
    groupLabel: 'Promotions',
    groupIcon: 'Sparkles',
    collapsible: true,

    // Only direct users get promotions (user, 2026-10-17), so only the Super Admin and its executives see this section.
    items: [
      // The campaigns on the player site's /promotions. Reads are the public routes (staff see drafts); writes are config:write.
      { icon: 'Megaphone', label: 'Promotions', href: '/promotions/campaigns', permission: 'config:read', promotions: true, direct: true, feature: 'promotions' },
      { icon: 'Gift', label: 'Bonus', href: '/bonus', permission: 'reports:read', promotions: true, direct: true, flag: 'bonus', feature: 'bonus' },

      // `admin/user/bonus-balance` and its stats answer any of reports:read, users:read, wallet:read.
      { icon: 'LockKeyhole', label: 'Bonus balances', href: '/bonus-balances', permission: ['reports:read', 'users:read', 'wallet:read'], promotions: true, direct: true },
      { icon: 'CreditCard', label: 'Gift cards', href: '/gift-cards', permission: 'reports:read', promotions: true, direct: true, flag: 'giftcards', feature: 'gift_cards' },
      { icon: 'Disc3', label: 'Spin wheel', href: '/spin-wheel', permission: 'reports:read', promotions: true, direct: true, flag: 'wheelspin', feature: 'spin_wheel' },
      { icon: 'Crown', label: 'VIP Club', href: '/vip', permission: 'reports:read', promotions: true, direct: true, flag: 'vipclub', feature: 'vip' },
      { icon: 'Link', label: 'Affiliate', href: '/affiliate', permission: 'reports:read', promotions: true, direct: true, flag: 'affiliate', feature: 'affiliate' },
      { icon: 'Flag', label: 'Races', href: '/races', permission: 'reports:read', promotions: true, direct: true, feature: 'races' },
      { icon: 'Ticket', label: 'Raffle', href: '/raffle', permission: 'reports:read', promotions: true, direct: true, feature: 'raffles' },
      { icon: 'Trophy', label: 'Challenges', href: '/challenges', permission: 'reports:read', promotions: true, direct: true, feature: 'challenges' },
      { icon: 'RotateCw', label: 'Reload bonuses', href: '/reload-bonuses', permission: 'reports:read', promotions: true, direct: true, flag: 'bonus', feature: 'bonus' }
    ]
  },
  {
    // Casino — ek hi section: andar koi doosra "Casino" dropdown nahi; priority screens bhi yahin (Settings se aaye).
    groupLabel: 'Casino',
    groupIcon: 'Spade',
    collapsible: true,
    items: [
      { icon: 'ListOrdered', label: 'Lobby curation', href: '/casino/curation', permission: 'casino:read', flag: 'casino' },
      { icon: 'Server', label: 'Providers', href: '/casino/providers', permission: 'casino:read', flag: 'casino' },

      // The house-games and bet-history admin reads are guarded by reports:read, not casino:read.
      { icon: 'History', label: 'Bet history', href: '/casino/bets', permission: 'reports:read', flag: 'casino' },
      { icon: 'ArrowBigUp', label: 'Vendor Priority', href: '/vendor-priority', permission: 'casino:read', flag: 'casino' },
      { icon: 'Gamepad2', label: 'Type Priority', href: '/type-priority', permission: 'casino:read', flag: 'casino' },
    ]
  },
  {
    // Original Games apna section, Casino se bahar (user, 2026-10-19).
    groupLabel: 'Original Games',
    groupIcon: 'Dices',
    collapsible: true,
    items: [
      // The aggregator's originals: dashboard, bets, games. Super Admin + its executives with originals:read (backend checks both).
      { icon: 'LayoutDashboard', label: 'Dashboard', href: '/casino/original-games', permission: 'originals:read', direct: true },
      { icon: 'TrendingUp', label: 'Turnover', href: '/casino/original-games/turnover', permission: 'originals:read', direct: true },
      { icon: 'History', label: 'Bet history', href: '/casino/original-games/bets', permission: 'originals:read', direct: true },
      { icon: 'Dices', label: 'Games', href: '/casino/original-games/games', permission: 'originals:read', direct: true },

      // Every staff below the Super Admin: its downline's bets and stats only, like Casino → Bet history (user, 2026-10-29).
      { icon: 'History', label: 'Bet history', href: '/casino/original-games/history', permission: 'reports:read', tree: true }
    ]
  },
  {
    groupLabel: 'Team',
    groupIcon: 'Contact',
    collapsible: true,
    items: [
      { icon: 'Target', label: 'Marketing', href: '/marketing', account: 'marketing' }
    ]
  },
  {
    groupLabel: 'Content',
    groupIcon: 'LayoutTemplate',
    collapsible: true,
    items: [
      { icon: 'Image', label: 'Banners', href: '/content/banners', permission: 'config:read', feature: 'banners' },

      // Level-gated profile pictures for the site's Edit avatar screen.
      { icon: 'CircleUserRound', label: 'Avatars', href: '/content/avatars', permission: 'config:read' },
      { icon: 'Newspaper', label: 'Blogs', href: '/content/blogs', permission: 'config:read', feature: 'blog' },

      // The device list and per-user history are users:read; sending (gated on the page) is config:write.
      { icon: 'Bell', label: 'Notifications', href: '/content/notifications', permission: ['users:read', 'config:write'], feature: 'notifications', direct: true },
      {
        /*
         * OneSignal web push. Hidden when the owner left `push_notifications` out of the plan —
         * every page would only say "Not in your plan". The routes still open from a direct link.
         */
        icon: 'BellRing',
        label: 'Push notifications',
        permission: 'config:read',
        feature: 'push_notifications',
        direct: true,
        childItems: [
          { icon: 'SquarePen', label: 'Compose', href: '/push/compose' },
          { icon: 'Send', label: 'Campaigns', href: '/push/campaigns' },
          { icon: 'LayoutTemplate', label: 'Push templates', href: '/push/templates' },
          { icon: 'Settings', label: 'Prompt & settings', href: '/push/settings' }
        ]
      }
    ]
  },
  {
    groupLabel: 'Reports',
    groupIcon: 'ChartPie',
    collapsible: true,

    // Not for agent logins (user, 2026-10-17): agents have their own reports under Agent Management.
    items: [
      { icon: 'ClipboardList', label: 'User reports', href: '/reports/players', permission: 'reports:read', promotions: true },
      { icon: 'BadgeDollarSign', label: 'Profit & loss', href: '/reports/pnl', permission: 'reports:read', promotions: true },
      { icon: 'ShieldAlert', label: 'Risk', href: '/reports/risk', permission: 'reports:read', promotions: true }
    ]
  },
  {
    // Site Config — Settings ke barabar alag section (pehle Settings ke andar dropdown tha).
    groupLabel: 'Site Config',
    groupIcon: 'Settings2',
    collapsible: true,
    items: [
      { icon: 'ToggleRight', label: 'Features', href: '/site-config/features', permission: 'config:read' },
      { icon: 'Palette', label: 'Branding', href: '/site-config/branding', permission: 'config:read' },
      { icon: 'Newspaper', label: 'Content', href: '/site-config/content', permission: 'config:read' },
      { icon: 'Flag', label: 'Feature flags', href: '/site-config/flags', permission: 'config:read' },
      { icon: 'Gauge', label: 'Limits and policy', href: '/site-config/limits', permission: 'config:read' },
    ]
  },
  {
    // Zip jaisa Settings: Payment Methods (+ My account). Priority screens Casino me, Site Config alag section.
    groupLabel: 'Settings',
    groupIcon: 'Settings',
    collapsible: true,
    items: [
      { icon: 'CreditCard', label: 'Payment Methods', href: '/payment-methods', permission: 'config:read', direct: true },
      { icon: 'CircleUserRound', label: 'My account', href: '/account' }
    ]
  }
]

/**
 * Every promotions route, plus the vault and swap history. Agent-tree logins (levels 4–6 and their executives) get a "not available"
 * notice on these instead of the screen, so no promotion API is called from a pasted URL either.
 */
export const PROMOTION_ROUTES = [
  '/promotions',
  '/bonus',
  '/redeem-codes',
  '/gift-cards',
  '/spin-wheel',
  '/vip',
  '/affiliate',
  '/races',
  '/raffle',
  '/reload-bonuses',
  '/challenges',
  '/vault',
  '/swap',
  '/site-config/affiliate',
  '/site-config/welcome-bonuses',

  // Not a promotion: the coin registry and the payment gateways are house configuration, refused to the agent tree the same way.
  '/coins',
  '/payment-methods',

  // The old cashier screens and the other Transactions entries: house only.
  '/deposits',
  '/withdrawals',
  '/reports/statements',
  '/kyc',
  '/bank-details',

  // The Reports section: Super Admin side only, not the agent system.
  '/reports'
]

/** Direct-user screens with no sidebar entry (the old cashier): Super Admin and its executives only, like `direct: true`. */
export const DIRECT_ROUTES = ['/deposits', '/withdrawals', '/p2p']

export const isPromotionRoute = (pathname: string) =>
  PROMOTION_ROUTES.some(route => pathname === route || pathname.startsWith(`${route}/`))

/**
 * What a route needs, read off the menu entry that links to it — the same `permission`,
 * `promotions` and `account` marks the sidebar filters on, so a pasted URL is refused exactly when
 * the sidebar would have hidden the link.
 *
 * `permissions` is every level of the menu chain (the group's grant AND the leaf's), each one an
 * any-of list. Sub-routes inherit their entry (`/users/42` → Users, `/exchange/users/create` → Account List);
 * the longest matching `href` wins. A route no entry links to has no requirement here.
 */
export type RouteRequirement = {
  href: string
  permissions: Array<string | string[]>
  promotions: boolean
  direct: boolean
  account?: 'marketing'

  /** Owner flags the chain needs (e.g. `sportsexchange`): a pasted URL is closed like the sidebar entry. */
  ownerFlags: string[]

  /** Owner-plan marks the sidebar also hides on (`feature`, the owner side of `flag`): a pasted URL says "not in your plan". */
  planFeatures: string[]
  planFlags: string[]
}

type Marks = { permission?: string | string[]; promotions?: boolean; direct?: boolean; account?: 'marketing'; ownerFlag?: string; feature?: string; flag?: string }

const collectRoutes = (): RouteRequirement[] => {
  const out: RouteRequirement[] = []

  const walk = (entry: Marks & { href?: string; childItems?: MenuSubItem[] }, chain: Marks[]) => {
    const marks = [...chain, entry]

    if (entry.href) {
      out.push({
        href: entry.href,
        permissions: marks.map(m => m.permission).filter((p): p is string | string[] => !!p && (!Array.isArray(p) || p.length > 0)),
        promotions: marks.some(m => m.promotions),
        direct: marks.some(m => m.direct),
        account: marks.find(m => m.account)?.account,
        ownerFlags: marks.map(m => m.ownerFlag).filter((f): f is string => !!f),
        planFeatures: marks.map(m => m.feature).filter((f): f is string => !!f),
        planFlags: marks.map(m => m.flag).filter((f): f is string => !!f)
      })
    }

    entry.childItems?.forEach(child => walk(child as Marks & { href?: string; childItems?: MenuSubItem[] }, marks))
  }

  navItems.forEach(group => group.items.forEach(item => walk(item as Marks & { href?: string; childItems?: MenuSubItem[] }, [])))

  return out.sort((a, b) => b.href.length - a.href.length)
}

const ROUTES = collectRoutes()

export const routeRequirement = (pathname: string): RouteRequirement | null =>
  ROUTES.find(r => pathname === r.href || pathname.startsWith(`${r.href}/`)) ?? null

/** The marks the sidebar filters an entry on (see `useNavVisible`). */
export type NavMarks = {
  permission?: string | string[]
  flag?: string
  ownerFlag?: string
  feature?: string
  account?: 'marketing'
  promotions?: boolean

  /** A direct-user screen: only the Super Admin and its executives (`actor.direct`). */
  direct?: boolean

  /** A downline screen: only staff below the Super Admin side (hidden where `actor.direct`). */
  tree?: boolean

  /** Staff's own logins only — an executive session never sees it (e.g. managing executives). */
  notExecutive?: boolean

  /** Hidden unless this owner on/off policy (`branch_management`, …) is on. */
  policy?: string
}

type NavEntry = NavMarks & { href?: string; childItems?: MenuSubItem[] }

/**
 * The first page, in sidebar order, that `visible` lets through — the landing route after sign-in.
 * `/account` (My account) opens for everyone, so it is only the answer when nothing else is.
 */
export const firstNavHref = (visible: (entry: NavMarks) => boolean): string => {
  const find = (entry: NavEntry): string | null => {
    if (!visible(entry)) return null
    if (entry.href) return entry.href

    for (const child of entry.childItems ?? []) {
      const hit = find(child as NavEntry)

      if (hit) return hit
    }

    return null
  }

  for (const group of navItems) {
    for (const item of group.items) {
      const hit = find(item as NavEntry)

      if (hit && hit !== '/account') return hit
    }
  }

  return '/account'
}
