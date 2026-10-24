'use client'

// React Imports
import { useState } from 'react'

// Third-party Imports
import { WalletIcon } from 'lucide-react'

// Component Imports
import { formatIn, useReportMoney } from '@/components/shared/ReportMoney'
import { useSession } from '@/contexts/SessionContext'
import { useApi } from '@/hooks/use-api'
import OwnerDirectLedger from '@/views/exchange/OwnerDirectLedger'
import type { OwnerWallet } from '@/views/exchange/types'

/**
 * Header me owner (super admin) ka Direct Users balance (`staff_balances`) — theme
 * toggle ke bagal me, sirf wallet icon + number. Agent System wala balance yahan nahi.
 * Sirf owner ko dikhta hai (executive ko nahi). Add Balance ke baad wahi query
 * invalidate hoti hai, isliye yahan bhi turant naya balance aa jata hai.
 * Click karne pe us wallet ka ledger khulta hai.
 */
const OwnerBalanceInner = () => {
  const { data, error } = useApi<OwnerWallet>('admin/exchange/owner/wallet')
  const [ledgerOpen, setLedgerOpen] = useState(false)

  // The wallet is kept in INR; shown in the owner's default coin at the live rate.
  const money = useReportMoney()
  const inr = data?.directBalance

  if (error && !data) return null

  return (
    <>
      <button
        type='button'
        onClick={() => setLedgerOpen(true)}
        className='border-border bg-muted/40 hover:bg-muted flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors'
        title={`Direct Users balance${inr !== undefined ? ` (${formatIn(Number(inr) || 0, 'INR')})` : ''} — click for the ledger`}
      >
        <WalletIcon className='text-primary size-3.5 shrink-0' />
        <span className='text-foreground font-semibold tabular-nums'>{inr === undefined ? '…' : money.format(inr, 'INR')}</span>
      </button>
      <OwnerDirectLedger open={ledgerOpen} onOpenChange={setLedgerOpen} />
    </>
  )
}

const OwnerBalance = () => {
  const { actor, can } = useSession()

  // Super Admin, or its executive granted wallet:adjust (the owner-wallet routes' permission).
  const isOwner = actor?.level === 1 && can('wallet:adjust')

  // owner na ho to API call hi nahi
  return isOwner ? <OwnerBalanceInner /> : null
}

export default OwnerBalance
