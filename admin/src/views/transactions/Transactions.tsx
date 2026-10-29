'use client'

import { useState, type ReactNode } from 'react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { ArrowLeftRightIcon, WalletIcon } from 'lucide-react'

import { useSession } from '@/contexts/SessionContext'
import CryptoDeposits from '@/views/finance/CryptoDeposits'
import CryptoWithdrawals from '@/views/finance/CryptoWithdrawals'
import FiatDeposits from '@/views/finance/FiatDeposits'
import FiatWithdrawals from '@/views/finance/FiatWithdrawals'
import PageHeader from '@/components/shared/PageHeader'
import PaymentOrders, { AllRails } from '@/views/finance/PaymentOrders'
import AgentLedger from './AgentLedger'
import ManualSwitch from './ManualSwitch'

type Part = { key: string; label: string; view: () => ReactNode }

/** Top tab (Direct Users / Agent System): underline style. */
const tabClass = (active: boolean) =>
  `flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
    active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
  }`

/** Rail switch (Crypto / Fiat / Manual): segmented pill. */
const pillClass = (active: boolean) =>
  `whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
  }`

/** Direct Users → zip ka "Crypto | Fiat" switcher; andar apne purane screens (unke actions ke saath). */
const DirectUsers = ({ parts }: { parts: Part[] }) => {
  const [key, setKey] = useState(parts[0].key)
  const active = parts.find(p => p.key === key) ?? parts[0]

  return (
    <div className='p-4 sm:p-6'>
      <div role='tablist' aria-label='Rail' className='bg-muted mb-6 inline-flex max-w-full overflow-x-auto rounded-lg p-1'>
        {parts.map(p => (
          <button key={p.key} type='button' role='tab' aria-selected={p.key === active.key} className={pillClass(p.key === active.key)} onClick={() => setKey(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      <div key={active.key}>{active.view()}</div>
    </div>
  )
}

// Fiat = gateway (PSP) wale fiat deposits / payouts. Manual = player ka bank transfer (screenshot) /
// manual payout request; upar Super Admin ka ON / OFF. Dono alag data — ek list do jagah nahi.
const DEPOSIT_PARTS: Part[] = [
  { key: 'crypto', label: 'Crypto', view: () => <CryptoDeposits /> },
  { key: 'fiat', label: 'Fiat', view: () => <PaymentOrders /> },
  {
    key: 'manual',
    label: 'Manual',
    view: () => (
      <>
        <ManualSwitch kind='deposit' />
        <FiatDeposits />
      </>
    )
  }
]

const WITHDRAW_PARTS: Part[] = [
  { key: 'crypto', label: 'Crypto', view: () => <CryptoWithdrawals /> },
  {
    key: 'fiat',
    label: 'Fiat',
    view: () => (
      <>
        <PageHeader title='Fiat withdrawals' description='Gateway (PSP) payouts across every fiat rail.' />
        <AllRails kind='withdrawals' />
      </>
    )
  },
  {
    key: 'manual',
    label: 'Manual',
    view: () => (
      <>
        <ManualSwitch kind='withdraw' />
        <FiatWithdrawals />
      </>
    )
  }
]

/**
 * Transactions → Deposit / Withdraw — admin-structure.zip `DepositPage` / `WithdrawPage` jaisa:
 * upar tab bar "Direct Users" (Crypto / Fiat (gateway) / Manual (bank transfer + Super Admin ON/OFF)) aur
 * "Agent System" (Sports Exchange point ledger se agent ↔ player len-den, `admin/agent-ledger`).
 * Tab URL me `?tab=direct|agent`.
 */
const Transactions = ({ direction }: { direction: 'deposit' | 'withdraw' }) => {
  const { can, flagEntitled } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const deposit = direction === 'deposit'

  const tabs = [
    can(deposit ? 'deposits:read' : 'withdrawals:read')
      ? { id: 'direct', label: 'Direct Users', icon: <WalletIcon className='size-4' />, view: () => <DirectUsers parts={deposit ? DEPOSIT_PARTS : WITHDRAW_PARTS} /> }
      : null,

    // The exchange's point ledger: gone while the owner runs the sportsbook.
    can('users:read') && flagEntitled('sportsexchange') ? { id: 'agent', label: 'Agent System', icon: <ArrowLeftRightIcon className='size-4' />, view: () => <AgentLedger direction={direction} /> } : null
  ].filter(t => t !== null)

  if (!tabs.length) return <p className='p-6 text-sm text-muted-foreground'>You do not have access to this page.</p>

  const active = tabs.find(t => t.id === params.get('tab')) ?? tabs[0]

  return (
    <div className='overflow-hidden rounded-xl border border-border'>
      <div className='overflow-x-auto border-b border-border bg-card px-2'>
        <div role='tablist' className='flex'>
          {tabs.map(t => (
            <button
              key={t.id}
              type='button'
              role='tab'
              aria-selected={t.id === active.id}
              className={tabClass(t.id === active.id)}
              onClick={() => router.replace(t.id === tabs[0].id ? pathname : `${pathname}?tab=${t.id}`, { scroll: false })}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>
      <div key={active.id} className='min-h-[80vh] bg-background'>
        {active.view()}
      </div>
    </div>
  )
}

export default Transactions
