'use client'

import { Coins } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useSession } from '@/contexts/SessionContext'
import { useApi } from '@/hooks/use-api'

/**
 * The site's reward currency — the ONE coin every reward (VIP, daily / weekly / monthly bonus,
 * rakeback, affiliate, spin wheel, races, welcome bonuses, redeem codes) is calculated and paid in.
 * The platform owner sets it in the owner panel (the `reward_currency` policy); staff only see it.
 *
 * Read from `GET admin/site-config/rewards` (house staff, `config:read`); anyone else falls back to
 * the public `admin/site-config/public` `rewardCurrency`. USDT until either answers — the backend's
 * own default.
 */
type Rewards = { rewardCurrency?: string; name?: string; managedBy?: 'owner' | null }
type PublicConfig = { rewardCurrency?: string }

export const DEFAULT_REWARD_CURRENCY = 'USDT'

export function useRewardCurrency() {
  // Without `config:read` (agents, masters) the staff read can only 403, so go straight to the public one.
  const canConfig = useSession().can('config:read')
  const staff = useApi<Rewards>(canConfig ? 'admin/site-config/rewards' : null, undefined, { retry: false, staleTime: 15_000 })
  const usePublic = !canConfig || staff.isError
  const pub = useApi<PublicConfig>(usePublic ? 'admin/site-config/public' : null, undefined, { staleTime: 15_000 })
  const code = staff.data?.rewardCurrency ?? pub.data?.rewardCurrency ?? DEFAULT_REWARD_CURRENCY

  return {
    code,
    name: staff.data?.name ?? code,
    managedBy: staff.data?.managedBy ?? (pub.data ? 'owner' : null),
    loading: (canConfig && staff.isLoading) || (usePublic && pub.isLoading)
  }
}

/** Read-only line for screens where rewards are configured. */
export function RewardCurrencyNotice({ className }: { className?: string }) {
  const { code, name, managedBy, loading } = useRewardCurrency()

  return (
    <Alert className={className} data-reward-currency={loading ? undefined : code}>
      <Coins />
      <AlertTitle>
        Reward currency: {loading ? '…' : code}
        {!loading && name !== code ? <span className='text-muted-foreground font-normal'> — {name}</span> : null}
      </AlertTitle>
      <AlertDescription>
        All rewards — VIP, bonuses, rakeback, affiliate, spin wheel — are calculated and paid in this currency, and every reward amount on
        this screen is in it.{' '}
        {managedBy === 'owner' ? null : 'Set on Site config → Features (Reward currency).'}
      </AlertDescription>
    </Alert>
  )
}
