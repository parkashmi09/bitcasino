export type PlayerRow = {
  id: string
  name: string
  avatar: string | null
  level: number
  status: string

  /** Lifetime bets (stake rows on the wallet ledger), every product. */
  gamesPlayed: number
  referralCode: string
  channel: 'direct' | 'agent'
  agentId: number | null
  balance: string

  /** Real deposits, every rail and coin, valued in INR. */
  totalDeposited: string
  totalWithdrawn: string

  /** Super Admin Direct User Wallet credit / debit (INR) — never a deposit / withdrawal. */
  adminCredited?: string
  adminDebited?: string
  wager: string

  /** House-only: null for agent-tree accounts. */
  vip: { level: number; card: string; nextLevel: number; wagerToNextLevel: string; progressPct: string } | null
}

/** `GET admin/reports/ip-tracker` — one login event. */
export type IpLoginRow = {
  id: string
  user: { id: string; name: string }
  ipAddress: string | null
  isPrivate: boolean
  countryCode: string | null
  country: string | null
  region: string | null
  city: string | null
  isp: string | null
  org: string | null
  asn: string | null
  isProxy: boolean | null
  isHosting: boolean | null
  source: string | null
  userAgent: string | null
  createdAt: string
}

/** `GET admin/reports/ip-tracker/shared` — an address two or more accounts used. */
export type SharedIpRow = {
  ipAddress: string
  isPrivate: boolean
  accounts: number
  logins: number
  firstSeen: string
  lastSeen: string
  proxyOrHosting: boolean
  countryCodes: string[]
  countries: string[]
  isp: string | null
  users: { id: string; name: string; logins: number; lastSeen: string }[]
}

/** `GET admin/reports/user-risk/:id` — the parts the Risk Management view reads. */
export type RiskIp = {
  ipAddress: string
  isPrivate: boolean
  uses: number
  countryCode?: string | null
  country: string | null
  region?: string | null
  city: string | null
  isp: string | null
  asn?: string | null
  isProxy?: boolean | null
  isHosting?: boolean | null
  firstSeen: string
  lastSeen: string
}
export type RiskBet = {
  id: string | number
  ipAddress: string | null
  createdAt: string
  stakeAmount: string
  currency: string
  status: string | null
  resultStatus: string | null
  event?: string | null
  market?: string | null
  selection?: string | null
  betType?: string | null
  odds?: string | null
}
export type RiskCasinoBet = {
  id: string
  source: 'inhouse' | 'og' | 'gis' | 'jsgames' | 'jsgamesv2' | 'seamless'
  createdAt: string
  game: string | null
  stakeAmount: string
  currency: string
  result: string | null
  profit: string | null
}
export type RiskLogin = {
  id: string | number
  ipAddress: string | null
  isPrivate: boolean
  city: string | null
  region: string | null
  country: string | null
  countryCode: string | null
  isp: string | null
  asn: string | null
  isProxy: boolean | null
  isHosting: boolean | null
  source: string | null
  userAgent: string | null
  device: string | null
  createdAt: string
}
export type PlayerRisk = {
  user: {
    id: string
    name: string
    email: string
    phone: string
    country: string
    created: string | null
    updatedAt: string | null
    level: number
    gamesPlayed: number
    twoFaEnabled: boolean
    staffId: string | null
    staffName: string | null
    staffEmail: string | null
    isDirect: boolean
    isOwnPlayer?: boolean
    lastIp: string | null
    lastLoginAt: string | null
  }
  registration: {
    ip: string | null
    source: 'signup' | 'first_login' | null
    isPrivate: boolean
    countryCode: string | null
    country: string | null
    region: string | null
    city: string | null
    isp: string | null
    registeredAt: string | null
    declaredCountry: string | null
  }
  locks: {
    isLocked: boolean
    lockTargetx: boolean
    sportsBetlocked: boolean
    casinoLocked: boolean
    withdrawLocked?: boolean
    originalsLocked?: boolean
    status?: string | null
    betStatus?: string | null
  }
  financials: {
    totalDeposit: string
    totalWithdrawal: string

    /** Direct User Wallet credit (INR) — not a deposit. */
    adminCredited?: string
    net: string
    reward: {
      currency: string
      totalDeposit: string
      totalWithdrawal: string
      net: string
      depositCount: number
      withdrawalCount: number
      unconverted: string[]
    }
  }
  activity: {
    distinctIpCount: number
    publicIpCount: number
    countries: { countryCode: string; country: string | null; logins: number }[]
    ipBreakdown: RiskIp[]
    recentLogins: RiskLogin[]
    recentBets: RiskBet[]
    recentCasinoBets?: RiskCasinoBet[]
  }
  sharedIps: { total: number; accounts: { id: string; name: string; ips: string[]; lastSeen: string }[] }
  withdrawalRatio?: { reward: number | null; inr: number | null; threshold: number }
  riskFlags: Record<string, boolean>
}

/** `GET admin/reports/geo-stats`. */
export type GeoStats = {
  totalPlayers: number
  registration: {
    located: number
    unknown: number
    bySource: { signup: number; firstLogin: number }
    countries: { countryCode: string; country: string; players: number }[]
    cities: { city: string; countryCode: string; country: string; players: number }[]
  }
  login: { players: number; countries: { countryCode: string; country: string; players: number; logins: number }[] }
}
