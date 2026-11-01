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
 * toggle ke bagal me: default coin ki image (INR ka ₹ coin) + number; image na ho to wallet icon. Agent System wala balance yahan nahi.
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
  const [noArt, setNoArt] = useState(false)
  const shown = inr === undefined ? null : money.convert(inr, 'INR')

  if (error && !data) return null

  return (
    <>
      <button
        type='button'
        onClick={() => setLedgerOpen(true)}
        className='bg-accent hover:bg-primary/16 flex h-8 items-center gap-2 rounded-full px-3 text-[13px] transition-colors duration-250'
        title={`Direct Users balance${inr !== undefined ? ` (${formatIn(Number(inr) || 0, 'INR')})` : ''} — click for the ledger`}
      >
        {noArt ? (
          <WalletIcon className='text-primary size-3.5 shrink-0' />
        ) : (
          <img src={`/images/coins/${money.code}.png`} alt={money.code} className='size-4 shrink-0 rounded-full' onError={() => setNoArt(true)} />
        )}
        <span className='text-foreground font-semibold tabular-nums'>
          {inr === undefined
            ? '…'
            : shown === null
              ? money.format(inr, 'INR')
              : shown.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
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
