/** Row types for the finance screens. Amounts are decimal strings on the wire. */

export type FiatDepositRow = {
  depositId: number
  userId: number | string
  amount: string
  currency: string
  transactionId: string
  bankName?: string | null
  accountHolderName?: string | null
  upiId?: string | null

  /** Manual crypto deposit (migration 118): the network and the house address it was sent to. */
  network?: string | null
  walletAddress?: string | null
  status: 'pending' | 'approved' | 'rejected' | string
  hasScreenshot: boolean
  adminComment?: string | null
  createdAt: string
  accountNumber?: string | null
  ifscCode?: string | null
  handledBy?: number | string | null
  handledAt?: string | null
  username?: string | null
  avatar?: string | null
}

export type DepositStats = {
  totalTransactions: number
  totalAmount: string
  successfulAmount: string
  processingAmount: string
  successfulTransactions: number
  processingTransactions: number
  failedTransactions: number
  currency: string
  byProvider?: Record<string, unknown>
}

export type CryptoDepositRow = {
  id: number | string
  userId: number | string
  chain?: string | null
  orderId?: string | null
  address?: string | null
  status: string
  coinId?: number | null

  /** Ticker from the coin id (`#<id>` when unknown); null when the row has no coin id. */
  coin: string | null

  /** In the coin, not USD: `COALESCE(price, amount)`. */
  amount: string

  /** Only when the rate table prices the coin. */
  amountUsd: string | null
  createdAt: string
}

/** `admin/user/history/deposits` and `/withdrawals` — every rail merged. */
export type RailTransactionRow = {
  provider: string
  id: number | string
  userId: number | string
  reference?: string | null
  amount: string
  currency: string
  status: string
  rawStatus?: string | null
  createdAt: string
}

/** `admin/user/payments/users/:userId/orders` */
export type PaymentOrderRow = {
  provider: string
  flow: 'payin' | 'payout' | string
  reference: string
  amount: string
  currency: string
  status: string
  rawStatus?: string | null
  providerReference?: string | null
  userId?: number | string
  createdAt?: string | null
}

export type FiatWithdrawalRow = {
  withdrawalId: number
  userId: number | string
  amount: string
  currency: string
  accountHolderName?: string | null
  bankName?: string | null
  upiId?: string | null
  status: string
  requestedAt?: string | null
  accountNumber?: string | null
  ifscCode?: string | null
  username?: string | null
  /** Staff's reason for the decision (a rejection's reason). */
  comment?: string | null
}

/** What staff can set. A player can also cancel a request still In Queue ('Cancelled', final). */
export const FIAT_WITHDRAW_STATUSES = ['In Queue', 'Approved', 'Rejected', 'Paid'] as const

export type CryptoWithdrawalRow = {
  id: number
  userId: number | string
  amount: string
  coin: string
  chain?: string | null
  wallet: string
  status: string
  txid?: string | null
  date?: string | null
  note?: string | null
  decidedBy?: number | string | null
  decidedAt?: string | null
}

export const CRYPTO_WITHDRAW_STATUSES = ['In Queue', 'Approved', 'Sent', 'Rejected'] as const

export type CryptoWithdrawSummary = { status: string; coin: string; count: number; total: string }

export type ExchangeRateRow = { currency: string; usdRate: string; lastUpdated?: string | null }

/** `GET admin/user/vault/stats` — platform-wide totals plus the locked balance per coin. */
export type VaultStats = {
  totalUsers: number

  /** Sum across every coin (mixed units) — show `byCoin` instead. */
  totalBalance: number
  todayInterest: number
  byCoin: { coin: string; totalBalance: string }[]
}

export type VaultLockPeriod = { value: string; label: string; days: number; rate: string }

/** Raw `vault_pro` rows — the platform returns them unshaped. */
export type VaultDepositRow = Record<string, unknown> & {
  id: number | string
  userid?: number | string
  coin?: string
  vaultBalance?: string
  lock_period?: string
  interest_rate?: string
  startTime?: string
  endTime?: string
  status?: string
  createdAt?: string
}

export type VaultInterestRow = Record<string, unknown> & {
  id: number | string
  userid?: number | string
  coin?: string
  deposit_id?: number | string
  interest?: string
  rate?: string
  createdAt?: string
}

/** P2P admin listings return raw rows (snake_case). */
export type P2pOrderRow = Record<string, unknown> & {
  id: number | string
  order_no?: string
  user_id?: string
  offer_id?: number | string
  coin?: string
  fiat?: string
  price?: string
  crypto_amount?: string
  fiat_amount?: string
  status?: string
  utr_number?: string | null
  expires_at?: string | null
  paid_at?: string | null
  created_at?: string
  payment_proof_size?: number | null
  admin_note?: string | null
  account_name?: string | null
  account_number?: string | null
  ifsc_code?: string | null
  upi_id?: string | null
  qr_image_type?: string | null
}

export type P2pDisputeRow = Record<string, unknown> & {
  id: number | string
  order_id?: number | string
  order_no?: string | null
  user_id?: string
  order_type?: 'BUY' | 'SELL' | string
  reason?: string
  message?: string | null
  status?: string
  admin_note?: string | null
  screenshot_size?: number | null
  resolved_at?: string | null
  created_at?: string
}

export type P2pOfferRow = Record<string, unknown> & {
  id: number | string
  coin?: string
  fiat?: string
  segment?: string
  price?: string
  availableAmount?: string
  minLimit?: string | null
  maxLimit?: string | null
  paymentTime?: number | null
  username?: string | null
  status?: string
  isFeatured?: boolean
  isVerified?: boolean
  isKycVerified?: boolean
  createdAt?: string
}

export type P2pPaymentType = Record<string, unknown> & { id: number | string; name?: string; code?: string; createdAt?: string; created_at?: string }

export type P2pPaymentAccount = Record<string, unknown> & {
  id: number | string
  paymentTypeId?: number | string
  accountName?: string | null
  accountNumber?: string | null
  ifscCode?: string | null
  upiId?: string | null
  extraDetails?: string | null
}

export const P2P_COINS = ['USDT', 'INR', 'BTC', 'ETH', 'TRX'] as const
export const P2P_FIAT = ['INR', 'USD', 'PKR', 'NPR', 'BDT'] as const
export const P2P_ORDER_STATUSES = ['PENDING', 'PAID', 'RELEASED', 'CANCELLED', 'EXPIRED', 'DISPUTED'] as const
export const P2P_SELL_STATUSES = ['PENDING', 'RELEASED', 'CANCELLED', 'EXPIRED', 'DISPUTED'] as const
export const P2P_DISPUTE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED'] as const
export const P2P_OFFER_STATUSES = ['ACTIVE', 'PAUSED', 'CLOSED'] as const

export type BankDetailRow = {
  id: number
  coinType: string
  bankName?: string | null
  accountNumber?: string | null
  ifscCode?: string | null
  accountHolderName?: string | null
  upiId?: string | null
  hasQrImage: boolean
  isActive: boolean
}

/**
 * The wallet's currency allow-list (`wallet.constants.SUPPORTED_CURRENCIES`).
 * BJB is retired (nothing may credit it) and so is not offered here.
 */
export const SUPPORTED_CURRENCIES = [
  'BTC', 'ETH', 'LTC', 'BCH', 'USDT', 'TRX', 'DOGE', 'ADA', 'XRP', 'BNB', 'USDP', 'NEXO', 'MKR', 'TUSD',
  'USDC', 'BUSD', 'NC', 'INR', 'SHIB', 'MATIC', 'SC', 'MVR', 'AED', 'NPR', 'PKR', 'EUR', 'BDT'
] as const

export const FIAT_CURRENCIES = ['INR', 'BDT', 'NPR', 'PKR', 'AED', 'EUR'] as const

export const PSP_PROVIDERS = ['waypay', 'apay', 'cricpay', 'upi', 'f2pay'] as const

/** A coin network: `key` is the contract a deposit / withdrawal names; `name` and `enabled` are the site's. */
export type CoinNetwork = { key: string; name: string; enabled: boolean }

/** `GET admin/currencies` — the coin registry (backend migration 061). */
export type CurrencyRow = {
  code: string
  kind: 'fiat' | 'crypto' | 'points'
  decimals: number
  builtin: boolean
  retired: boolean
  name: string
  symbol: string
  sortOrder: number
  networks: CoinNetwork[]

  /** In the owner's plan (owner panel). Off: the site cannot switch it on. */
  ownerEnabled: boolean

  /** The site's own switch (mirrors the siteconfig flag). */
  siteEnabled: boolean

  /** What players get: owner AND site AND not retired. */
  enabled: boolean
  image: string | null
  imageVersion: string | null
  imageContentType: string | null
  managedBy: 'owner' | null
  updatedAt: string | null
}

/** One side of a tip: the player's id and username. */
export type TipParty = { id: string | number; name: string | null }

/** `GET admin/user/tip/admin/list` — one player-to-player tip. `amount` is a decimal string. */
export type TipRow = {
  id: string | number
  from: TipParty
  to: TipParty
  currency: string
  amount: string
  note: string | null
  createdAt: string
}

/** The list's totals for the same filters (not just the page). */
export type TipSummary = {
  totalTips: number
  byCurrency: Array<{ currency: string; count: number; amount: string }>
}

export type TipList = { rows: TipRow[]; total: number; summary: TipSummary }
