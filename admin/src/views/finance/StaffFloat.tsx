'use client'

import Link from 'next/link'

import Money from '@/components/shared/Money'
import { isAgentTreeLevel, useSession } from '@/contexts/SessionContext'
import { useApi } from '@/hooks/use-api'
import { errorMessage } from '@/lib/api/client'

/** `GET admin/accounts/float` — the caller's own float: balance, credit line, what is available. */
export type StaffFloat = { staffId: number; currency: string; balance: string; creditLimit: string; available: string }

/**
 * Is this session in the agent tree (levels 4–6 and their executives)? For them a wallet
 * "adjust" is a transfer from their own float, never new money, and always needs the
 * transaction password.
 */
export const useIsAgentTree = () => {
  const { actor } = useSession()

  return Boolean(actor && (isAgentTreeLevel(actor.level) || actor.promotions === false))
}

/** Has the caller set a transaction password? `GET admin/auth/transaction-password`. */
export const useTransactionPasswordSet = () => useApi<{ set: boolean; mode?: 'login' | 'separate' }>('admin/auth/transaction-password')

/**
 * The money-dialog field label. With the backend's TXN_PASSWORD_MODE=login (the default) the
 * "transaction password" is the staff member's own login password; `separate` keeps the old name.
 */
export const TxnPasswordLabel = () => {
  const txn = useTransactionPasswordSet()

  return <>{txn.data?.mode === 'separate' ? 'Transaction password' : 'Password (your login password)'}</>
}

/**
 * The caller's available float, shown inside a money dialog for agent-tree staff — so "credit
 * 5,000" is never a surprise refusal (422 INSUFFICIENT_FUNDS, details.party = staff).
 */
export const StaffFloatNote = () => {
  const float = useApi<StaffFloat>('admin/accounts/float')
  const txn = useTransactionPasswordSet()
  const f = float.data

  return (
    <div className='bg-muted/40 grid gap-1 rounded-md border p-3 text-sm'>
      <div className='flex justify-between'>
        <span className='text-muted-foreground'>Your balance</span>
        <Money value={f?.balance} currency={f?.currency ?? 'INR'} />
      </div>
      {f && Number(f.creditLimit) > 0 && (
        <div className='flex justify-between'>
          <span className='text-muted-foreground'>Credit line</span>
          <Money value={f.creditLimit} currency={f.currency} />
        </div>
      )}
      <div className='flex justify-between font-medium'>
        <span>Available to give</span>
        <Money value={f?.available} currency={f?.currency ?? 'INR'} />
      </div>
      {float.error ? <p className='text-danger text-xs'>Could not load your balance: {errorMessage(float.error)}</p> : null}
      <p className='text-muted-foreground text-xs'>
        A credit moves money from your balance to the player; a debit moves it back to you. INR only.
      </p>
      {txn.data && !txn.data.set && (
        <p className='text-danger text-xs'>
          You have no transaction password yet. Set one under <Link href='/account' className='underline'>My account</Link> first.
        </p>
      )}
    </div>
  )
}
