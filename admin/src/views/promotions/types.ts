/** Row shapes for the promotions area — mirrors the user-service `#shape*` mappers. Amounts are decimal strings. */

// ── Bonus (admin/user/bonus/*) ────────────────────────────────────────

export const BONUS_TYPES = ['daily', 'weekly', 'monthly'] as const
export type BonusType = (typeof BONUS_TYPES)[number]

export const GAME_COUNTERS = ['luckyspin', 'dailybonus', 'weeklybonus', 'monthlybonus', 'depositbonus', 'rollcompetitionbonus', 'rakebackbonus'] as const
export type GameCounter = (typeof GAME_COUNTERS)[number]

export type BonusRecord = {
  userId: number | string
  name: string | null
  total: string
  vip: string
  special: string
  general: string
  joining: string
  rake: string
  amounts: Record<BonusType, { pending: string; paid: string }>

  /** The site's reward currency every amount on the row is in (USDT by default). */
  currency?: string
}

export type BonusGameRow = {
  id: number
  userId: number | string
  counters: Record<GameCounter, string>
  createdAt: string | null
  updatedAt: string | null
}

export type BonusEvent = {
  id: number
  userId: number | string
  event: string
  amount: string
  createdAt: string | null
  updatedAt: string | null
}

/** Raw `bonus_claims` row — the platform returns it unshaped. */
export type BonusAward = Record<string, unknown> & {
  id: number
  userid?: number | string
  bonus_type?: string
  bonus_amount?: string
  is_claimed?: boolean
  claimed_at?: string | null
  created_at?: string | null
}

export type BonusDashboard = {
  total: number

  /** The site's reward currency every paid figure is in. */
  currency?: string
  users: { userId: number | string; name: string | null; vip: number; bonuses: Record<BonusType, string> }[]
  history: { id: number; userId: number | string; type: string; amount: string; claimed: boolean; claimedAt: string | null; createdAt: string | null; vip: number }[]
}

export type BonusUserInspect = {
  vip: { level: number; card: string; wager: string; nextLevel: number | null; wagerToNextLevel: string; progressPct: string }
  currency: string
  types: Record<BonusType, { amount: string; totalPaid: string; minVipLevel: number; eligible: boolean; claimable: boolean; award: unknown }>
}

export type BonusUserId = { userid: number | string; name: string | null }

export const CODE_STATUSES = ['active', 'redeemed', 'expired', 'superseded'] as const

export type RedeemCode = {
  id: number
  userId: number | string
  code: string
  amount: string
  bonusPct: string | null
  kind: 'percentage' | 'amount'
  status: string
  source: string | null
  createdAt: string | null
}

// ── Gift cards (admin/user/gift-cards/*) ──────────────────────────────

export type GiftCard = {
  id: number
  uniqueKey: string
  description: string | null
  amount: string
  currency: string
  periodDays: number | null
  endDate: string | null
  depositRequired: boolean
  depositAmount: string | null
  wagerRequired: boolean
  wagerTimes: number | null
  allUsers: boolean
  isActive: boolean
}

export type GiftCardRecord = {
  id: number
  userId: number | string
  status: string
  startDate: string | null
  card: GiftCard | null
}

export type GiftCardAnalytics = {
  totalCards: number
  activated: number
  claimed: number
  expired: number
  cards: { id: number; uniqueKey: string; amount: string | null; createdAt: string | null; activations: number; claims: number }[]
}

// ── Spin wheel (admin/user/spin-wheel/*) ──────────────────────────────

export type SpinConfig = {
  id: number
  minDeposit: string
  claimCooldownDays: number
  isActive: boolean
  unlimitedSpin: boolean

  /** The most one won code adds to one deposit, in the reward currency. */
  maxBonus: string

  /** Wagering on a spin bonus (× the bonus) before it becomes cash; null = the first-deposit multiplier. */
  wagerMultiplier?: number | null

  /** Days an unwagered spin bonus stays in the bonus balance (0 = never expires). */
  bonusExpiryDays?: number
}

export type SpinSlice = {
  id?: number
  label: string
  rewardPct: string
  color: string | null
  sortOrder: number
  isBadLuck: boolean
  weight: number
}

export type SpinClaim = {
  id: number
  userId: number | string
  username: string | null
  depositAmount: string
  rewardAmount: string
  sliceLabel: string | null
  redeemCode: string | null
  claimedAt: string | null
}

// ── Affiliate (admin/user/affiliate/*) ────────────────────────────────

export type AffiliateStats = {
  teams: number
  members: number
  unlockedCount: number
  unlockedTotal: string
  claimedCount: number
  claimedTotal: string
  outstanding: string
  currency: string
}

export type AffiliateTeam = { owner: string; members: number }
export type AffiliateTeamMember = { member: string; referralCode: string | null; joinedAt: string | null }
export type AffiliateMember = { owner: string; member: string; joinedAt: string | null }
export type AffiliateTop = { owner: string; rewards: number; total: string; currency: string }

export type AffiliateReward = {
  id: number

  /** `tier` = a joining / wager-step reward (unlocked_rewards), `commission` = wager commission (rewards). */
  kind?: 'tier' | 'commission'
  owner: string
  member: string
  amount: string
  currency: string
  tier: string | null
  claimed: boolean
}

// ── Races (admin/user/race/*, user/race/*) ────────────────────────────

export const RACE_TYPES = ['daily', 'weekly', 'monthly'] as const
export type RaceType = (typeof RACE_TYPES)[number]
export const RACE_BUCKETS = ['sports', 'crash', 'slot', 'casino', 'other'] as const
export type RaceBucket = (typeof RACE_BUCKETS)[number]

export type RaceConfig = {
  type: RaceType
  enabled: boolean
  multipliers: Record<RaceBucket, string>
  prizePool: string
  netPrizePool: string
  currency: string
  platformFeePercent: string
  winnerCount: number
  top3Percentage: string
  minPoints: string
  rankPrizes: { rank: number; amount: string; percentage: number }[]
  bookedSeatsEnabled: boolean

  /** A rank (any free entry) or a rank pinned to one entry. */
  bookedSeats: (number | { rank: number; boatId: number })[]
}

export type RaceRow = {
  id: number
  type: RaceType
  startsAt: string
  endsAt: string
  status: string
  settledAt: string | null
  prizePool: string
  winnerCount: number
  totalAwarded: string
}

export type RaceReward = {
  id: number
  raceId: number
  type: RaceType
  rank: number
  points: string
  amount: string
  currency: string
  claimed: boolean
  claimedAt: string | null
  createdAt: string | null
  raceStartsAt: string | null
  raceEndsAt: string | null
  userId: string
  username: string | null
}

export type RaceBoat = {
  id: number
  name: string
  isActive: boolean
  dailyPoints: string
  weeklyPoints: string
  dailyRank: number | null
  weeklyRank: number | null
}

export type RaceLeaderboard = {
  raceId: number
  type: RaceType
  startsAt: string
  endsAt: string
  prizePool: string
  netPrizePool: string
  currency: string
  winnerCount: number
  leaderboard: { rank: number; userId: number | string | null; name: string | null; points: string; usdWagered: string; bets: number; isBoat: boolean; reward: string; percentage: number }[]
  unratedCurrencies: string[]
}

// ── VIP ladder (user/vip/levels) + clubs (admin/user/clubs/*) ─────────

/** One band of the ladder. `maxXp` is null on the top band (open-ended). */
export type VipLevel = { level: number; name?: string; card: string; minXp: string | number; maxXp: string | number | null }

/** `GET user/vip/levels` — the ladder with its metadata, not a bare array. */
export type VipLadder = {
  ladder: string
  label: string
  unranked: { level: number; name?: string; card: string }
  bonusGates: { daily?: number; weekly?: number; monthly?: number }
  levels: VipLevel[]
}

export type Club = {
  id: number
  code: string
  name: string
  description: string | null
  ownerId: number | string
  parentClubId: number | null
  maxMembers: number | null
  isActive: boolean
  profilePicture: string | null
  earnings: { owner: string; agent: string; member: string }
  members?: number
}

export type ClubMember = {
  id: number
  userId: number | string
  clubId: number
  role: string
  agentCode: string | null
  agentId: number | null
  joinedAt: string | null
  user: { id: number | string; name: string | null; level: number | null } | null
}

export type ClubEarning = {
  id: number
  beneficiaryId: number | string
  role: string
  wager: string
  percentage: string
  amount: string
  currency: string
  paid: boolean
  createdAt: string | null
}
