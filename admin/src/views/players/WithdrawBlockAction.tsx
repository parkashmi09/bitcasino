'use client'

import { BanknoteIcon, BanknoteXIcon, LockIcon } from 'lucide-react'

import ConfirmDialog from '@/components/shared/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'

/** The lock columns `GET admin/reports/players/:id` reports. */
export type AccountLocks = { system?: boolean; casino?: boolean; sports?: boolean; withdraw?: boolean }

type Target = { kind: 'user'; id: string }

/** The chip shown in a page header while withdrawals are blocked. */
export const WithdrawBlockedBadge = ({ locks }: { locks?: AccountLocks }) =>
  locks?.withdraw ? (
    <Badge variant='destructive'>
      <BanknoteXIcon /> Withdrawals blocked
    </Badge>
  ) : null

/** The chip shown in a page header while casino and/or sports betting is locked. */
export const BetLockedBadge = ({ locks }: { locks?: AccountLocks }) => {
  if (!locks?.casino && !locks?.sports) return null
  const what = locks.casino && locks.sports ? 'Bets locked' : locks.casino ? 'Casino bets locked' : 'Sports bets locked'

  return (
    <Badge variant='destructive'>
      <LockIcon /> {what}
    </Badge>
  )
}

/**
 * Block / unblock withdrawals through the same `POST admin/locks` the other locks use
 * (`users:write`, audited as `account.lock`). Sirf user (agent wala system yahan nahi).
 */
const WithdrawBlockAction = ({ target, locks, invalidate }: { target: Target; locks?: AccountLocks; invalidate: (string | null)[][] }) => {
  const blocked = Boolean(locks?.withdraw)

  const apply = useApiMutation<boolean>({
    fn: withdraw => api.post('admin/locks', { userId: Number(target.id), withdraw }),
    invalidate,
    success: (_r, withdraw) => `Withdrawals ${withdraw ? 'blocked' : 'unblocked'}`
  })

  // An older backend that does not report the state: no button, rather than a guess.
  if (locks?.withdraw === undefined) return null

  return blocked ? (
    <ConfirmDialog
      trigger={
        <Button variant='outline'>
          <BanknoteIcon /> Unblock withdrawals
        </Button>
      }
      title='Unblock withdrawals?'
      description={'This user can request withdrawals again. A block held by their agent’s subtree lock stays until that agent is unblocked.'}
      confirmLabel='Unblock withdrawals'
      onConfirm={() => apply.mutateAsync(false)}
    />
  ) : (
    <ConfirmDialog
      trigger={
        <Button variant='outline'>
          <BanknoteXIcon /> Block withdrawals
        </Button>
      }
      title='Block withdrawals?'
      description={'This user can no longer request any withdrawal, payout, P2P sell or tip, effective immediately. Betting and deposits are not affected.'}
      confirmLabel='Block withdrawals'
      destructive
      onConfirm={() => apply.mutateAsync(true)}
    />
  )
}

export default WithdrawBlockAction
